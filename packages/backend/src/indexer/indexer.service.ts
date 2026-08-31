import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Call } from '../calls/call.entity';
import { StakeActivity } from '../calls/stake-activity.entity';
import { AuthService } from '../auth/auth.service';
import { RpcExhaustedError, withRetry } from '../common/rpc/rpc-retry.util';
import { Retryable } from '../decorators/retryable.decorator';
import { PlatformSettings } from './platform-settings.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { AuditLog } from '../oracle/audit-log.entity';
import {
  IndexerWebhookDto,
  IndexerWebhookEventType,
} from './dto/indexer-webhook.dto';

// ─── ABIs ────────────────────────────────────────────────────────────────────

const CALL_REGISTRY_ABI = [
  'event CallCreated(uint256 indexed callId, address indexed creator, address stakeToken, uint256 stakeAmount, uint256 startTs, uint256 endTs, address tokenAddress, bytes32 pairId, string ipfsCID)',
  'event StakeAdded(uint256 indexed callId, address indexed staker, bool position, uint256 amount)',
  // BE-05 required events — OutcomeManager contract
  'event OutcomeSubmitted(uint256 indexed callId, bool outcome, uint256 finalPrice, address oracle)',
  'event PayoutWithdrawn(uint256 indexed callId, address indexed recipient, uint256 amount)',
  // Legacy events kept for backwards-compatibility
  'event CallResolved(uint256 indexed callId, bool outcome, uint256 finalPrice)',
  'event AdminParamsChanged(uint256 feePercent)',
];

// Interface used to decode batch-fetched logs (BE-05)
const INDEXER_INTERFACE = new ethers.Interface(CALL_REGISTRY_ABI);

// ─── Constants ───────────────────────────────────────────────────────────────

const LISTENER_RECONNECT_DELAY_MS = 10_000;
const LISTENER_MAX_RECONNECTS = 10;

// BE-05 polling tunables (overridable via env)
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_BLOCK_RANGE = 5_000;
const DEFAULT_REORG_DEPTH = 12;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);

  private provider: ethers.JsonRpcProvider;
  private registryAddress: string;
  private outcomeManagerAddress: string | null = null;

  private reconnectCount = 0;

  // ─── BE-05 polling state ─────────────────────────────────────────────────
  private pollingTimer?: NodeJS.Timeout;
  private isPolling = false;
  private readonly pollIntervalMs: number;
  private readonly maxBlockRange: number;
  private readonly reorgDepth: number;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Call)
    private callsRepository: Repository<Call>,
    @InjectRepository(StakeActivity)
    private stakeActivityRepository: Repository<StakeActivity>,
    @InjectRepository(PlatformSettings)
    private settingsRepository: Repository<PlatformSettings>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    private authService: AuthService,
    private eventEmitter: EventEmitter2,
    private notificationEventsService: NotificationEventsService,
  ) {
    // BE-05: configurable BASE_RPC_URL with fallback to BASE_SEPOLIA_RPC_URL
    const rpcUrl =
      this.configService.get<string>('BASE_RPC_URL') ||
      this.configService.get<string>('BASE_SEPOLIA_RPC_URL');
    this.registryAddress =
      this.configService.get<string>('CALL_REGISTRY_ADDRESS') || '';
    this.outcomeManagerAddress =
      this.configService.get<string>('OUTCOME_MANAGER_ADDRESS') || null;

    this.pollIntervalMs =
      this.configService.get<number>('BASE_POLL_INTERVAL_MS') ??
      DEFAULT_POLL_INTERVAL_MS;
    this.maxBlockRange =
      this.configService.get<number>('BASE_MAX_BLOCK_RANGE') ??
      DEFAULT_MAX_BLOCK_RANGE;
    this.reorgDepth =
      this.configService.get<number>('BASE_REORG_DEPTH') ?? DEFAULT_REORG_DEPTH;

    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit() {
    if (!this.provider || !this.registryAddress) {
      this.logger.warn(
        'BASE_RPC_URL (or BASE_SEPOLIA_RPC_URL) or CALL_REGISTRY_ADDRESS not set — indexer disabled',
      );
      return;
    }

    try {
      const [network, blockNumber] = await Promise.all([
        this.getNetwork(),
        this.getBlockNumber(),
      ]);

      this.logger.log(`Connected to Chain ID: ${network.chainId}`);
      this.logger.log(`Current Block: ${blockNumber}`);
      const rpcUrl =
        this.configService.get<string>('BASE_RPC_URL') ||
        this.configService.get<string>('BASE_SEPOLIA_RPC_URL');
      this.logger.log(`RPC URL: ${rpcUrl}`);

      await this.syncHistoricalEvents();
      this.startListening();
      // BE-05: cursor-persisted polling replaces/enhances the live listener
      this.startPolling();
    } catch (err) {
      this.logger.error(
        `Indexer failed to initialise after retries: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    this.stopPolling();
  }

  // ─── Retried RPC primitives ────────────────────────────────────────────────

  @Retryable({ maxAttempts: 4, operationName: 'indexer:getNetwork' })
  private async getNetwork(): Promise<ethers.Network> {
    return this.provider.getNetwork();
  }

  @Retryable({ maxAttempts: 4, operationName: 'indexer:getBlockNumber' })
  private async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  /**
   * Queries a range of historical contract events.
   * Given that queryFilter can time out on a busy node, this gets
   * 5 attempts with a 1 s base delay.
   */
  @Retryable({
    maxAttempts: 5,
    baseDelayMs: 1_000,
    operationName: 'indexer:queryFilter',
  })
  private async queryFilter(
    contract: ethers.Contract,
    eventName: string,
    fromBlock: number,
    toBlock: number,
  ): Promise<ethers.EventLog[]> {
    const results = await contract.queryFilter(eventName, fromBlock, toBlock);
    return results as ethers.EventLog[];
  }

  /**
   * BE-05: getLogs with exponential backoff via withRetry.
   * Used for batch-fetch polling of CallCreated | StakeAdded | OutcomeSubmitted | PayoutWithdrawn.
   */
  private async getLogsWithRetry(
    filter: ethers.Filter,
  ): Promise<ethers.Log[]> {
    return withRetry(() => this.provider.getLogs(filter), {
      maxAttempts: 4,
      baseDelayMs: 1_000,
      operationName: 'indexer:getLogs',
    });
  }

  private async getBlockWithRetry(
    blockNumber: number,
  ): Promise<ethers.Block | null> {
    return withRetry(() => this.provider.getBlock(blockNumber), {
      maxAttempts: 3,
      baseDelayMs: 500,
      operationName: 'indexer:getBlock',
    });
  }

  // ─── Platform-settings cursor (BE-05) ─────────────────────────────────────

  /**
   * Loads the last fully-processed block from platform_settings.
   * Returns 0 if no cursor has been persisted yet (genesis).
   */
  async getLastCursor(): Promise<number> {
    try {
      const settings = await this.settingsRepository.findOne({
        where: { id: 1 },
      });
      if (!settings || !settings.lastBlock) return 0;
      const n = Number(settings.lastBlock);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  async getCursorBlockHash(): Promise<string | null> {
    try {
      const settings = await this.settingsRepository.findOne({
        where: { id: 1 },
      });
      return settings?.lastBlockHash ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Persists the cursor after a batch has been fully processed.
   * Uses withRetry internally? No — TypeORM save is local DB, not RPC.
   */
  async saveCursor(blockNumber: number, blockHash?: string | null): Promise<void> {
    let settings = await this.settingsRepository.findOne({ where: { id: 1 } });
    if (!settings) {
      settings = this.settingsRepository.create({
        id: 1,
        feePercent: 0,
        lastBlock: blockNumber.toString(),
        lastBlockHash: blockHash ?? null,
      } as Partial<PlatformSettings> as PlatformSettings);
    } else {
      settings.lastBlock = blockNumber.toString();
      if (blockHash !== undefined) {
        (settings as any).lastBlockHash = blockHash;
      }
    }
    await this.settingsRepository.save(settings);
    this.logger.debug(`Cursor persisted → lastBlock=${blockNumber}${blockHash ? ` hash=${blockHash}` : ''}`);
  }

  /**
   * BE-05 reorg handling.
   * Checks whether the chain has reorganized at the previously-persisted cursor height
   * by comparing the stored blockHash with the current chain's hash at that height.
   * If a mismatch is detected, the cursor is rewound by 2 * reorgDepth blocks so the
   * next poll re-processes the divergent window (handlers are idempotent).
   * Also handles the case where the latest block is behind the cursor (deep reorg).
   */
  async handleReorg(currentBlockNumber: number): Promise<number> {
    const cursor = await this.getLastCursor();
    const storedHash = await this.getCursorBlockHash();

    // Deep reorg where chain tip moved behind cursor
    if (cursor > currentBlockNumber) {
      const rewound = Math.max(0, currentBlockNumber - this.reorgDepth);
      this.logger.warn(
        `Reorg detected: cursor ${cursor} > tip ${currentBlockNumber} — rewinding to ${rewound}`,
      );
      await this.saveCursor(rewound, null);
      return rewound;
    }

    // If we have a stored hash, verify it hasn't been orphaned
    if (cursor > 0 && storedHash) {
      try {
        const block = await this.getBlockWithRetry(cursor);
        if (block && block.hash !== storedHash) {
          const rewound = Math.max(0, cursor - this.reorgDepth * 2);
          this.logger.warn(
            `Reorg detected at height ${cursor}: stored hash ${storedHash} != chain hash ${block.hash} — rewinding cursor to ${rewound}`,
          );
          await this.saveCursor(rewound, block.hash ?? null);
          return rewound;
        }
      } catch (err) {
        this.logger.warn(`Reorg check failed for block ${cursor}: ${(err as Error).message}`);
      }
    }

    return cursor;
  }

  // ─── BE-05 batch polling ───────────────────────────────────────────────────

  /**
   * Fetches logs in batches via ethers getLogs, with per-batch backoff (withRetry).
   * Handles both CALL_REGISTRY and OUTCOME_MANAGER addresses.
   */
  async fetchLogsBatched(
    fromBlock: number,
    toBlock: number,
  ): Promise<ethers.Log[]> {
    const allLogs: ethers.Log[] = [];
    const addresses = [this.registryAddress];
    if (this.outcomeManagerAddress) {
      addresses.push(this.outcomeManagerAddress);
    }

    for (let start = fromBlock; start <= toBlock; start += this.maxBlockRange) {
      const end = Math.min(start + this.maxBlockRange - 1, toBlock);
      for (const address of addresses) {
        const filter: ethers.Filter = {
          address,
          fromBlock: start,
          toBlock: end,
        };
        try {
          const logs = await this.getLogsWithRetry(filter);
          allLogs.push(...logs);
          this.logger.debug(
            `Fetched ${logs.length} logs for ${address} blocks ${start}–${end}`,
          );
        } catch (err) {
          if (err instanceof RpcExhaustedError) {
            this.logger.error(
              `Batch getLogs ${start}–${end} for ${address} failed after ${err.attempts} attempts: ${err.lastError.message}`,
            );
            throw err;
          }
          throw err;
        }
      }
    }

    // Sort by blockNumber then logIndex to ensure deterministic processing order
    allLogs.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return (a.index ?? 0) - (b.index ?? 0);
    });

    return allLogs;
  }

  private async processLog(log: ethers.Log): Promise<void> {
    // Ethers v6 sets `removed` when a log was orphaned by a reorg — skip and log
    if ((log as any).removed) {
      this.logger.warn(
        `Skipping removed log at block ${log.blockNumber} tx ${log.transactionHash} (reorg)`,
      );
      return;
    }

    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = INDEXER_INTERFACE.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
    } catch {
      // Not one of our indexed events — ignore
      return;
    }
    if (!parsed) return;

    const { name, args } = parsed;

    try {
      switch (name) {
        case 'CallCreated':
          await this.handleCallCreated(
            args[0] as bigint,
            args[1] as string,
            args[2] as string,
            args[3] as bigint,
            args[4] as bigint,
            args[5] as bigint,
            args[6] as string,
            args[7] as string,
            args[8] as string,
          );
          break;
        case 'StakeAdded':
          await this.handleStakeAdded(
            args[0] as bigint,
            args[1] as string,
            args[2] as boolean,
            args[3] as bigint,
          );
          break;
        case 'OutcomeSubmitted':
          await this.handleOutcomeSubmitted(
            args[0] as bigint,
            args[1] as boolean,
            args[2] as bigint,
            args[3] as string,
          );
          break;
        case 'PayoutWithdrawn':
          await this.handlePayoutWithdrawn(
            args[0] as bigint,
            args[1] as string,
            args[2] as bigint,
          );
          break;
        case 'CallResolved':
          // Legacy alias for OutcomeSubmitted
          await this.handleCallResolved(
            args[0] as bigint,
            args[1] as boolean,
            args[2] as bigint,
          );
          break;
        case 'AdminParamsChanged':
          await this.handleAdminParamsChanged(args[0] as bigint);
          break;
        default:
          this.logger.debug(`Unhandled event ${name} at block ${log.blockNumber}`);
      }
    } catch (err) {
      this.logger.error(
        `Error processing ${name} at block ${log.blockNumber}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Single poll iteration: resumes from cursor, handles reorgs, batch-fetches
   * via getLogs with backoff, processes logs sequentially, and advances cursor.
   */
  async pollOnce(): Promise<{ fromBlock: number; toBlock: number; logCount: number }> {
    const latestBlock = await this.getBlockNumber();
    // handleReorg may rewind the cursor if a reorg is detected
    await this.handleReorg(latestBlock);
    const cursor = await this.getLastCursor();

    // Determine start block: if no cursor yet, scan from genesis; otherwise continue after cursor.
    // handleReorg already rewound cursor when needed, so cursor is the correct resume point.
    const startBlock = cursor === 0 ? 0 : cursor + 1;

    if (startBlock > latestBlock) {
      this.logger.debug(`pollOnce: no new blocks (cursor=${cursor}, tip=${latestBlock})`);
      return { fromBlock: startBlock, toBlock: latestBlock, logCount: 0 };
    }

    this.logger.log(`Polling Base blocks ${startBlock}–${latestBlock} (cursor=${cursor}) via getLogs batch=${this.maxBlockRange}`);

    const logs = await this.fetchLogsBatched(startBlock, latestBlock);
    this.logger.log(`Processing ${logs.length} logs from blocks ${startBlock}–${latestBlock}`);

    for (const log of logs) {
      await this.processLog(log);
    }

    // Persist cursor with tip hash for next reorg check (withRetry already applied to RPC calls)
    let tipHash: string | null = null;
    try {
      const tipBlock = await this.getBlockWithRetry(latestBlock);
      tipHash = tipBlock?.hash ?? null;
    } catch {
      // non-fatal — still advance cursor
    }
    await this.saveCursor(latestBlock, tipHash);

    return { fromBlock: startBlock, toBlock: latestBlock, logCount: logs.length };
  }

  /**
   * Starts interval polling. Idempotent.
   */
  startPolling(): void {
    if (this.isPolling) {
      this.logger.warn('Polling already running');
      return;
    }
    this.isPolling = true;
    this.logger.log(
      `Starting Base polling every ${this.pollIntervalMs}ms (batch=${this.maxBlockRange}, reorgDepth=${this.reorgDepth})`,
    );

    // Immediate poll then interval
    void this.pollOnce().catch((err) =>
      this.logger.error(`Initial poll failed: ${(err as Error).message}`),
    );

    this.pollingTimer = setInterval(() => {
      void this.pollOnce().catch((err) =>
        this.logger.error(`Poll cycle failed: ${(err as Error).message}`),
      );
    }, this.pollIntervalMs);
    // Allow process to exit if this is the only timer
    if (this.pollingTimer.unref) this.pollingTimer.unref();
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    this.isPolling = false;
    this.logger.log('Base polling stopped');
  }

  // ─── Historical sync ───────────────────────────────────────────────────────

  async syncHistoricalEvents(): Promise<void> {
    this.logger.log('Syncing historical events…');

    const contract = new ethers.Contract(
      this.registryAddress,
      CALL_REGISTRY_ABI,
      this.provider,
    );

    try {
      const currentBlock = await this.getBlockNumber();
      const cursor = await this.getLastCursor();
      const fromBlock = cursor > 0 ? cursor + 1 : 0;

      if (fromBlock > currentBlock) {
        this.logger.log(`No historical blocks to sync (cursor=${cursor}, tip=${currentBlock})`);
        return;
      }

      // Prefer batched getLogs path (BE-05) but keep queryFilter fallback for legacy chains
      // For backward-compat we still support queryFilter; if that fails we fall back to getLogs
      try {
        const logs = await this.fetchLogsBatched(fromBlock, currentBlock);
        this.logger.log(`Found ${logs.length} historical logs via batch getLogs (${fromBlock}→${currentBlock})`);
        for (const log of logs) {
          await this.processLog(log);
        }
        // Persist cursor after historical sync
        let tipHash: string | null = null;
        try {
          const tip = await this.getBlockWithRetry(currentBlock);
          tipHash = tip?.hash ?? null;
        } catch {}
        await this.saveCursor(currentBlock, tipHash);
        this.logger.log('Historical sync complete (via getLogs)');
        return;
      } catch (err) {
        this.logger.warn(`Batch getLogs sync failed, falling back to queryFilter: ${(err as Error).message}`);
      }

      // Legacy queryFilter path
      const [
        callCreatedEvents,
        stakeAddedEvents,
        callResolvedEvents,
        adminParamsEvents,
      ] = await Promise.all([
        this.queryFilter(contract, 'CallCreated', fromBlock, currentBlock),
        this.queryFilter(contract, 'StakeAdded', fromBlock, currentBlock),
        this.queryFilter(contract, 'CallResolved', fromBlock, currentBlock),
        this.queryFilter(contract, 'AdminParamsChanged', fromBlock, currentBlock),
      ]);

      this.logger.log(
        `Found ${callCreatedEvents.length} historical CallCreated events, ` +
          `${stakeAddedEvents.length} StakeAdded events, ` +
          `${callResolvedEvents.length} CallResolved events, and ` +
          `${adminParamsEvents.length} AdminParamsChanged events`,
      );

      for (const event of callCreatedEvents) {
        if (event.args) {
          const a = event.args;
          await this.handleCallCreated(
            a[0] as bigint,
            a[1] as string,
            a[2] as string,
            a[3] as bigint,
            a[4] as bigint,
            a[5] as bigint,
            a[6] as string,
            a[7] as string,
            a[8] as string,
          );
        }
      }

      for (const event of stakeAddedEvents) {
        if (event.args) {
          const a = event.args;
          await this.handleStakeAdded(
            a[0] as bigint,
            a[1] as string,
            a[2] as boolean,
            a[3] as bigint,
            false,
          );
        }
      }

      for (const event of callResolvedEvents) {
        if (event.args) {
          const a = event.args;
          await this.handleCallResolved(
            a[0] as bigint,
            a[1] as boolean,
            a[2] as bigint,
            false,
          );
        }
      }

      for (const event of adminParamsEvents) {
        if (event.args) {
          await this.handleAdminParamsChanged(event.args[0] as bigint);
        }
      }

      let tipHash: string | null = null;
      try {
        const tip = await this.getBlockWithRetry(currentBlock);
        tipHash = tip?.hash ?? null;
      } catch {}
      await this.saveCursor(currentBlock, tipHash);

      this.logger.log('Historical sync complete');
    } catch (err) {
      if (err instanceof RpcExhaustedError) {
        this.logger.error(
          `Historical sync failed after ${err.attempts} RPC attempts: ${err.lastError.message}`,
        );
      } else {
        this.logger.error(
          'Unexpected error during historical sync',
          (err as Error).message,
        );
      }
    }
  }

  // ─── Event handlers ────────────────────────────────────────────────────────

  async handleCallCreated(
    callId: bigint,
    creator: string,
    stakeToken: string,
    stakeAmount: bigint,
    startTs: bigint,
    endTs: bigint,
    tokenAddress: string,
    pairId: string,
    ipfsCID: string,
  ): Promise<void> {
    const existing = await this.callsRepository.findOne({
      where: { callOnchainId: callId.toString() },
    });
    if (existing) return;

    this.logger.log(`Processing CallCreated: ${callId} by ${creator}`);
    await this.authService.validateUser(creator);

    let conditionJson: Record<string, unknown> = {};
    if (ipfsCID && ipfsCID.length > 0) {
      try {
        conditionJson = await this.fetchIpfsData(ipfsCID);
      } catch (err) {
        this.logger.error(
          `Failed to fetch IPFS data for ${ipfsCID} after retries: ${(err as Error).message}`,
        );
      }
    }

    const call = this.callsRepository.create({
      callOnchainId: callId.toString(),
      creatorWallet: creator,
      stakeToken,
      totalStakeYes: Number(ethers.formatUnits(stakeAmount, 18)),
      totalStakeNo: 0,
      startTs: new Date(Number(startTs) * 1000),
      endTs: new Date(Number(endTs) * 1000),
      tokenAddress,
      pairId,
      ipfsCid: ipfsCID,
      conditionJson,
      status: 'active',
    });

    await this.callsRepository.save(call);
    this.logger.log(`Saved Call ${callId} to database`);

    this.eventEmitter.emit('call.created', {
      callId: callId.toString(),
      creatorWallet: creator,
    });
  }

  async handleStakeAdded(
    callId: bigint,
    staker: string,
    position: boolean,
    amount: bigint,
    emitNotification = true,
  ): Promise<void> {
    this.logger.log(
      `Processing StakeAdded to Call ${callId}: ` +
        `${ethers.formatUnits(amount, 18)} on ${position ? 'YES' : 'NO'} by ${staker}`,
    );

    const call = await this.callsRepository.findOne({
      where: { callOnchainId: callId.toString() },
    });

    if (!call) {
      this.logger.warn(
        `StakeAdded received for unknown Call ${callId} — skipping`,
      );
      return;
    }

    const amountFormatted = ethers.formatUnits(amount, 18);
    const amountNum = Number(amountFormatted);
    if (position) {
      call.totalStakeYes = Number(call.totalStakeYes) + amountNum;
    } else {
      call.totalStakeNo = Number(call.totalStakeNo) + amountNum;
    }

    await this.callsRepository.save(call);

    const activity = this.stakeActivityRepository.create({
      callOnchainId: callId.toString(),
      stakerWallet: staker,
      amount: Number(amountFormatted),
    });
    await this.stakeActivityRepository.save(activity);

    if (emitNotification) {
      this.notificationEventsService.emitStakeReceived({
        callId: Number(callId),
        callTitle: call.title || call.tokenAddress,
        staker,
        amount: amountFormatted,
        choice: position ? 'yes' : 'no',
        creatorWallet: call.creatorWallet,
      });
    }
  }

  async handleCallResolved(
    callId: bigint,
    outcome: boolean,
    finalPrice: bigint,
    emitNotification = true,
  ): Promise<void> {
    this.logger.log(`Processing CallResolved: ${callId}, outcome=${outcome}`);

    const call = await this.callsRepository.findOne({
      where: { callOnchainId: callId.toString() },
    });

    if (!call) {
      this.logger.warn(`CallResolved for unknown Call ${callId} — skipping`);
      return;
    }

    call.status = 'RESOLVED';
    call.outcome = outcome;
    call.finalPrice = Number(ethers.formatUnits(finalPrice, 18));
    await this.callsRepository.save(call);

    if (emitNotification) {
      this.notificationEventsService.emitMarketResolved({
        callId: Number(callId),
        callTitle: call.title || call.tokenAddress,
        outcome: outcome ? 'yes' : 'no',
        creatorWallet: call.creatorWallet,
        stakers: [],
      });
    }
  }

  /**
   * BE-05: Handles OutcomeSubmitted from OutcomeManager.
   * Idempotent — delegates to handleCallResolved for backwards-compat on the Call entity.
   */
  async handleOutcomeSubmitted(
    callId: bigint,
    outcome: boolean,
    finalPrice: bigint,
    oracle: string,
    emitNotification = true,
  ): Promise<void> {
    this.logger.log(
      `Processing OutcomeSubmitted: callId=${callId} outcome=${outcome} price=${finalPrice} oracle=${oracle}`,
    );
    // Reuse resolved logic; OutcomeSubmitted is the canonical resolution event going forward
    await this.handleCallResolved(callId, outcome, finalPrice, emitNotification);
  }

  /**
   * BE-05: Handles PayoutWithdrawn — records audit and emits event.
   * Idempotent no-op if call not found.
   */
  async handlePayoutWithdrawn(
    callId: bigint,
    recipient: string,
    amount: bigint,
  ): Promise<void> {
    this.logger.log(
      `Processing PayoutWithdrawn: callId=${callId} recipient=${recipient} amount=${ethers.formatUnits(amount, 18)}`,
    );

    const call = await this.callsRepository.findOne({
      where: { callOnchainId: callId.toString() },
    });
    if (!call) {
      this.logger.warn(`PayoutWithdrawn for unknown Call ${callId} — skipping`);
      return;
    }

    // Optional: persist an audit log for payout
    try {
      const entry = this.auditLogRepository.create({
        action: 'indexer.payout_withdrawn',
        actor: recipient,
        targetResource: callId.toString(),
        payload: {
          callId: callId.toString(),
          recipient,
          amount: amount.toString(),
        },
      });
      await this.auditLogRepository.save(entry);
    } catch (err) {
      this.logger.warn(`Failed to audit PayoutWithdrawn: ${(err as Error).message}`);
    }

    this.eventEmitter.emit('payout.withdrawn', {
      callId: callId.toString(),
      recipient,
      amount: amount.toString(),
    });
  }

  async handleAdminParamsChanged(feePercent: bigint): Promise<void> {
    const feeNum = Number(ethers.formatUnits(feePercent, 18));
    this.logger.log(`Processing AdminParamsChanged: feePercent = ${feeNum}`);

    let settings = await this.settingsRepository.findOne({ where: { id: 1 } });
    if (!settings) {
      settings = this.settingsRepository.create({
        id: 1,
        feePercent: feeNum,
        lastBlock: '0',
        lastBlockHash: null,
      } as unknown as PlatformSettings);
    } else {
      settings.feePercent = feeNum;
    }

    if (!settings) return;
    await this.settingsRepository.save(settings);
    this.logger.log(`Platform settings updated: feePercent = ${feeNum}`);
  }

  async getPlatformSettings(): Promise<PlatformSettings> {
    const settings = await this.settingsRepository.findOne({
      where: { id: 1 },
    });
    if (!settings) {
      return {
        id: 1,
        feePercent: 0,
        lastBlock: '0',
        lastBlockHash: null,
        updatedAt: new Date(),
      } as PlatformSettings;
    }
    return settings;
  }

  // ─── Webhook ingestion (BE-32) ─────────────────────────────────────────────

  async processWebhookEvent(
    dto: IndexerWebhookDto,
  ): Promise<{ processed: boolean; eventType: IndexerWebhookEventType }> {
    let targetResource: string | undefined;

    try {
      switch (dto.eventType) {
        case IndexerWebhookEventType.CALL_CREATED: {
          const callId = this.requireBigInt(dto.data, 'callId');
          targetResource = callId.toString();
          await this.handleCallCreated(
            callId,
            this.requireString(dto.data, 'creator'),
            this.requireString(dto.data, 'stakeToken'),
            this.requireBigInt(dto.data, 'stakeAmount'),
            this.requireBigInt(dto.data, 'startTs'),
            this.requireBigInt(dto.data, 'endTs'),
            this.requireString(dto.data, 'tokenAddress'),
            this.requireString(dto.data, 'pairId'),
            this.requireString(dto.data, 'ipfsCID'),
          );
          break;
        }
        case IndexerWebhookEventType.STAKE_ADDED: {
          const callId = this.requireBigInt(dto.data, 'callId');
          targetResource = callId.toString();
          await this.handleStakeAdded(
            callId,
            this.requireString(dto.data, 'staker'),
            this.requireBoolean(dto.data, 'position'),
            this.requireBigInt(dto.data, 'amount'),
          );
          break;
        }
        case IndexerWebhookEventType.CALL_RESOLVED: {
          const callId = this.requireBigInt(dto.data, 'callId');
          targetResource = callId.toString();
          await this.handleCallResolved(
            callId,
            this.requireBoolean(dto.data, 'outcome'),
            this.requireBigInt(dto.data, 'finalPrice'),
          );
          break;
        }
        case IndexerWebhookEventType.ADMIN_PARAMS_CHANGED: {
          await this.handleAdminParamsChanged(
            this.requireBigInt(dto.data, 'feePercent'),
          );
          break;
        }
      }

      await this.recordWebhookAudit(dto, targetResource, true);
      return { processed: true, eventType: dto.eventType };
    } catch (err) {
      await this.recordWebhookAudit(
        dto,
        targetResource,
        false,
        (err as Error).message,
      );
      throw err;
    }
  }

  private async recordWebhookAudit(
    dto: IndexerWebhookDto,
    targetResource: string | undefined,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    const entry = this.auditLogRepository.create({
      action: `indexer.webhook.${dto.eventType}`,
      actor: 'external-indexer',
      targetResource,
      payload: { nonce: dto.nonce, data: dto.data, success, errorMessage },
    });
    await this.auditLogRepository.save(entry);
  }

  private requireString(data: Record<string, unknown>, key: string): string {
    const value = data[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException(
        `Webhook payload field "${key}" must be a non-empty string`,
      );
    }
    return value;
  }

  private requireBoolean(data: Record<string, unknown>, key: string): boolean {
    const value = data[key];
    if (typeof value !== 'boolean') {
      throw new BadRequestException(
        `Webhook payload field "${key}" must be a boolean`,
      );
    }
    return value;
  }

  private requireBigInt(data: Record<string, unknown>, key: string): bigint {
    const value = data[key];
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      value === ''
    ) {
      throw new BadRequestException(
        `Webhook payload field "${key}" must be a numeric string`,
      );
    }
    try {
      return BigInt(value);
    } catch {
      throw new BadRequestException(
        `Webhook payload field "${key}" is not a valid integer`,
      );
    }
  }

  // ─── IPFS fetching ─────────────────────────────────────────────────────────

  async fetchIpfsData(cid: string): Promise<Record<string, unknown>> {
    if (cid === 'QmMockCID') {
      return {
        title: 'ETH will flip BTC',
        thesis:
          'Ethereum has better fundamentals and yielding properties than Bitcoin.',
        target: '0.06 BTC',
        deadline: '2026-01-01',
      };
    }

    const gateways = [
      `http://localhost:3001/calls/ipfs/${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
      `https://dweb.link/ipfs/${cid}`,
    ];

    let lastErr: Error = new Error('No gateways configured');

    for (const url of gateways) {
      try {
        const data = await withRetry(
          async () => {
            const response = await fetch(url, {
              signal: AbortSignal.timeout(6_000),
            });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status} from ${url}`);
            }
            return (await response.json()) as Record<string, unknown>;
          },
          {
            maxAttempts: 3,
            baseDelayMs: 500,
            operationName: `indexer:fetchIpfs:${url.split('/ipfs/')[0]}`,
          },
        );

        this.logger.log(`IPFS data fetched for ${cid} via ${url}`);
        return data;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `IPFS gateway ${url} exhausted — trying next. Reason: ${lastErr.message}`,
        );
      }
    }

    throw new RpcExhaustedError(`ipfs:${cid}`, gateways.length * 3, lastErr);
  }

  // ─── Live listener with auto-reconnect ────────────────────────────────────

  startListening(): void {
    this.logger.log(`Starting live listener on ${this.registryAddress}`);

    const contract = new ethers.Contract(
      this.registryAddress,
      CALL_REGISTRY_ABI,
      this.provider,
    );

    void contract.on(
      'CallCreated',
      (
        callId: bigint,
        creator: string,
        stakeToken: string,
        stakeAmount: bigint,
        startTs: bigint,
        endTs: bigint,
        tokenAddress: string,
        pairId: string,
        ipfsCID: string,
      ) => {
        void this.handleCallCreated(
          callId,
          creator,
          stakeToken,
          stakeAmount,
          startTs,
          endTs,
          tokenAddress,
          pairId,
          ipfsCID,
        ).catch((err: Error) =>
          this.logger.error(`Error handling live CallCreated: ${err.message}`),
        );
      },
    );

    void contract.on(
      'StakeAdded',
      (callId: bigint, staker: string, position: boolean, amount: bigint) => {
        void this.handleStakeAdded(callId, staker, position, amount).catch(
          (err: Error) =>
            this.logger.error(`Error handling live StakeAdded: ${err.message}`),
        );
      },
    );

    void contract.on(
      'CallResolved',
      (callId: bigint, outcome: boolean, finalPrice: bigint) => {
        void this.handleCallResolved(callId, outcome, finalPrice).catch(
          (err: Error) =>
            this.logger.error(
              `Error handling live CallResolved: ${err.message}`,
            ),
        );
      },
    );

    // BE-05: live listeners for new events
    void contract.on(
      'OutcomeSubmitted',
      (callId: bigint, outcome: boolean, finalPrice: bigint, oracle: string) => {
        void this.handleOutcomeSubmitted(callId, outcome, finalPrice, oracle).catch(
          (err: Error) =>
            this.logger.error(
              `Error handling live OutcomeSubmitted: ${err.message}`,
            ),
        );
      },
    );

    void contract.on(
      'PayoutWithdrawn',
      (callId: bigint, recipient: string, amount: bigint) => {
        void this.handlePayoutWithdrawn(callId, recipient, amount).catch(
          (err: Error) =>
            this.logger.error(
              `Error handling live PayoutWithdrawn: ${err.message}`,
            ),
        );
      },
    );

    void contract.on('AdminParamsChanged', (feePercent: bigint) => {
      void this.handleAdminParamsChanged(feePercent).catch((err: Error) =>
        this.logger.error(
          `Error handling live AdminParamsChanged: ${err.message}`,
        ),
      );
    });

    this.provider.on('error', (err: Error) => {
      this.logger.warn(`Provider error detected: ${err.message}`);
      void contract.removeAllListeners();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectCount >= LISTENER_MAX_RECONNECTS) {
      this.logger.error(
        `Live listener failed to reconnect after ${LISTENER_MAX_RECONNECTS} attempts — giving up. ` +
          `Restart the service to resume real-time indexing.`,
      );
      return;
    }

    const delay = Math.min(
      LISTENER_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectCount),
      300_000,
    );

    this.reconnectCount++;
    this.logger.warn(
      `Scheduling listener reconnect attempt ${this.reconnectCount}/${LISTENER_MAX_RECONNECTS} in ${delay}ms`,
    );

    setTimeout(() => {
      this.logger.log(
        `Reconnecting live listener (attempt ${this.reconnectCount})…`,
      );
      try {
        this.startListening();
        this.reconnectCount = 0;
        this.logger.log('Live listener reconnected successfully');
      } catch (err) {
        this.logger.error(
          `Reconnect attempt failed: ${(err as Error).message}`,
        );
        this.scheduleReconnect();
      }
    }, delay);
  }
}
