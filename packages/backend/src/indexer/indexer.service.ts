import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Call } from '../calls/call.entity';
import { AuthService } from '../auth/auth.service';
import { RpcExhaustedError, withRetry } from '../common/rpc/rpc-retry.util';
import { Retryable } from '../decorators/retryable.decorator';
import { PlatformSettings } from './platform-settings.entity';

// ─── Constants ───────────────────────────────────────────────────────────────

const CALL_REGISTRY_ABI = [
  'event CallCreated(uint256 indexed callId, address indexed creator, address stakeToken, uint256 stakeAmount, uint256 startTs, uint256 endTs, address tokenAddress, bytes32 pairId, string ipfsCID)',
  'event StakeAdded(uint256 indexed callId, address indexed staker, bool position, uint256 amount)',
  'event AdminParamsChanged(uint256 feePercent)',
];

/** How long to wait before attempting to reconnect the live listener (ms). */
const LISTENER_RECONNECT_DELAY_MS = 10_000;

/** Maximum reconnect attempts before giving up on the live listener. */
const LISTENER_MAX_RECONNECTS = 10;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly logger = new Logger(IndexerService.name);

  private provider: ethers.JsonRpcProvider;
  private registryAddress: string;

  /** Tracks how many times the live listener has been reconnected. */
  private reconnectCount = 0;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Call)
    private callsRepository: Repository<Call>,
    @InjectRepository(PlatformSettings)
    private settingsRepository: Repository<PlatformSettings>,
    private authService: AuthService,
  ) {
    const rpcUrl = this.configService.get<string>('BASE_SEPOLIA_RPC_URL');
    this.registryAddress =
      this.configService.get<string>('CALL_REGISTRY_ADDRESS') || '';

    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit() {
    if (!this.provider || !this.registryAddress) {
      this.logger.warn(
        'BASE_SEPOLIA_RPC_URL or CALL_REGISTRY_ADDRESS not set — indexer disabled',
      );
      return;
    }

    try {
      // Both calls are retried internally via @Retryable
      const [network, blockNumber] = await Promise.all([
        this.getNetwork(),
        this.getBlockNumber(),
      ]);

      this.logger.log(`Connected to Chain ID: ${network.chainId}`);
      this.logger.log(`Current Block: ${blockNumber}`);
      this.logger.log(
        `RPC URL: ${this.configService.get<string>('BASE_SEPOLIA_RPC_URL')}`,
      );

      await this.syncHistoricalEvents();
      this.startListening();
    } catch (err) {
      // If even the retried init calls fail, log and leave the indexer offline
      // rather than crashing the whole application.
      this.logger.error(
        `Indexer failed to initialise after retries: ${(err as Error).message}`,
      );
    }
  }

  // ─── Retried RPC primitives ────────────────────────────────────────────────

  /**
   * Fetches the connected network info.
   * Retried up to 4 times with exponential backoff before throwing.
   */
  @Retryable({ maxAttempts: 4, operationName: 'indexer:getNetwork' })
  private async getNetwork(): Promise<ethers.Network> {
    return this.provider.getNetwork();
  }

  /**
   * Fetches the latest block number.
   * Retried up to 4 times with exponential backoff before throwing.
   */
  @Retryable({ maxAttempts: 4, operationName: 'indexer:getBlockNumber' })
  private async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  /**
   * Queries a range of historical contract events.
   * Given that queryFilter can time out on a busy node, this gets
   * 5 attempts with a 1 s base delay.
   */
  @Retryable({ maxAttempts: 5, baseDelayMs: 1_000, operationName: 'indexer:queryFilter' })
  private async queryFilter(
    contract: ethers.Contract,
    eventName: string,
    fromBlock: number,
    toBlock: number,
  ): Promise<ethers.EventLog[]> {
    const results = await contract.queryFilter(eventName, fromBlock, toBlock);
    return results as ethers.EventLog[];
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

      // queryFilter is already wrapped with @Retryable above
      const [callCreatedEvents, stakeAddedEvents, adminParamsEvents] = await Promise.all([
        this.queryFilter(contract, 'CallCreated', 0, currentBlock),
        this.queryFilter(contract, 'StakeAdded', 0, currentBlock),
        this.queryFilter(contract, 'AdminParamsChanged', 0, currentBlock),
      ]);

      this.logger.log(
        `Found ${callCreatedEvents.length} historical CallCreated events, ` +
        `${stakeAddedEvents.length} StakeAdded events, and ` +
        `${adminParamsEvents.length} AdminParamsChanged events`,
      );

      for (const event of callCreatedEvents) {
        if (event.args) {
          const a = event.args;
          await this.handleCallCreated(
            a[0] as bigint, a[1] as string, a[2] as string,
            a[3] as bigint, a[4] as bigint, a[5] as bigint,
            a[6] as string, a[7] as string, a[8] as string,
          );
        }
      }

      for (const event of stakeAddedEvents) {
        if (event.args) {
          const a = event.args;
          await this.handleStakeAdded(
            a[0] as bigint, a[1] as string, a[2] as boolean, a[3] as bigint,
          );
        }
      }

      for (const event of adminParamsEvents) {
        if (event.args) {
          await this.handleAdminParamsChanged(event.args[0] as bigint);
        }
      }

      this.logger.log('Historical sync complete');
    } catch (err) {
      if (err instanceof RpcExhaustedError) {
        this.logger.error(
          `Historical sync failed after ${err.attempts} RPC attempts: ${err.lastError.message}`,
        );
      } else {
        this.logger.error('Unexpected error during historical sync', (err as Error).message);
      }
      // Do not rethrow — a failed historical sync should not prevent the live listener from starting
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
        // IPFS fetch exhausted all retries — store the call anyway with empty metadata
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
  }

  async handleStakeAdded(
    callId: bigint,
    staker: string,
    position: boolean,
    amount: bigint,
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

    const amountNum = Number(ethers.formatUnits(amount, 18));
    if (position) {
      call.totalStakeYes = Number(call.totalStakeYes) + amountNum;
    } else {
      call.totalStakeNo = Number(call.totalStakeNo) + amountNum;
    }

    await this.callsRepository.save(call);
  }

  async handleAdminParamsChanged(feePercent: bigint): Promise<void> {
    const feeNum = Number(ethers.formatUnits(feePercent, 18));
    this.logger.log(`Processing AdminParamsChanged: feePercent = ${feeNum}`);

    let settings = await this.settingsRepository.findOne({ where: { id: 1 } });
    if (!settings) {
      settings = this.settingsRepository.create({ id: 1, feePercent: feeNum });
    } else {
      settings.feePercent = feeNum;
    }

    await this.settingsRepository.save(settings);
    this.logger.log(`Platform settings updated: feePercent = ${feeNum}`);
  }

  async getPlatformSettings(): Promise<PlatformSettings> {
    let settings = await this.settingsRepository.findOne({ where: { id: 1 } });
    if (!settings) {
      // Return default if not populated yet
      return { id: 1, feePercent: 0, updatedAt: new Date() } as PlatformSettings;
    }
    return settings;
  }

  // ─── IPFS fetching ─────────────────────────────────────────────────────────

  /**
   * Fetches JSON metadata from IPFS, trying multiple gateways in order.
   *
   * Each gateway attempt is individually retried with exponential backoff
   * via withRetry(). If every gateway exhausts its attempts, the last
   * RpcExhaustedError is re-thrown so the caller can decide how to degrade.
   *
   * Gateway priority:
   *   1. Local proxy (avoids CORS, fastest in dev)
   *   2. Pinata cloud
   *   3. ipfs.io
   *   4. dweb.link
   */
  async fetchIpfsData(cid: string): Promise<Record<string, unknown>> {
    // Stable mock — no network call needed in tests / local dev
    if (cid === 'QmMockCID') {
      return {
        title: 'ETH will flip BTC',
        thesis: 'Ethereum has better fundamentals and yielding properties than Bitcoin.',
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
        // Each gateway gets its own retry budget: 3 attempts, 500 ms base
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
          }
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

    // All gateways failed — throw so handleCallCreated can log and store empty metadata
    throw new RpcExhaustedError(`ipfs:${cid}`, gateways.length * 3, lastErr);
  }

  // ─── Live listener with auto-reconnect ────────────────────────────────────

  /**
   * Attaches ethers.js event listeners for real-time contract events.
   *
   * If the provider emits an 'error' event (dropped WebSocket, rate-limit, etc.)
   * the listener tears itself down and schedules a reconnect with exponential
   * backoff, up to LISTENER_MAX_RECONNECTS times.
   */
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
        callId: bigint, creator: string, stakeToken: string,
        stakeAmount: bigint, startTs: bigint, endTs: bigint,
        tokenAddress: string, pairId: string, ipfsCID: string,
      ) => {
        void this.handleCallCreated(
          callId, creator, stakeToken, stakeAmount,
          startTs, endTs, tokenAddress, pairId, ipfsCID,
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

    void contract.on('AdminParamsChanged', (feePercent: bigint) => {
      void this.handleAdminParamsChanged(feePercent).catch((err: Error) =>
        this.logger.error(`Error handling live AdminParamsChanged: ${err.message}`),
      );
    });

    // Attach a provider-level error handler to detect dropped connections
    this.provider.on('error', (err: Error) => {
      this.logger.warn(`Provider error detected: ${err.message}`);
      void contract.removeAllListeners();
      this.scheduleReconnect();
    });
  }

  /**
   * Schedules a listener reconnect with exponential backoff.
   * Gives up after LISTENER_MAX_RECONNECTS consecutive failures.
   */
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
      300_000, // cap at 5 minutes
    );

    this.reconnectCount++;
    this.logger.warn(
      `Scheduling listener reconnect attempt ${this.reconnectCount}/${LISTENER_MAX_RECONNECTS} in ${delay}ms`,
    );

    setTimeout(() => {
      this.logger.log(`Reconnecting live listener (attempt ${this.reconnectCount})…`);
      try {
        this.startListening();
        // Reset counter on successful reconnect
        this.reconnectCount = 0;
        this.logger.log('Live listener reconnected successfully');
      } catch (err) {
        this.logger.error(`Reconnect attempt failed: ${(err as Error).message}`);
        this.scheduleReconnect();
      }
    }, delay);
  }
}