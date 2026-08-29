import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ethers } from 'ethers';
import { Keypair } from '@stellar/stellar-sdk';
import * as nacl from 'tweetnacl';
import { AdminService } from '../admin/admin.service';
import { IpfsService } from '../ipfs/ipfs.service';
import { Call } from '../calls/call.entity';
import { AuditLog, AuditLogAction } from './audit-log.entity';
import { IKeySigner, LocalWalletSigner, KmsSigner } from './key-signer';

// ─── Retry configuration ────────────────────────────────────────────────────

interface RetryOptions {
  maxAttempts?: number; // total attempts including the first call (default: 4)
  baseDelayMs?: number; // initial backoff in ms                   (default: 1000)
  factor?: number; // exponential growth factor               (default: 2)
  maxDelayMs?: number; // ceiling on any single delay             (default: 30_000)
  jitter?: number; // ±fraction of delay to randomise         (default: 0.2)
  operationName?: string; // label used in log lines
}

// Thrown when every retry attempt has been exhausted
export class RpcExhaustedError extends Error {
  constructor(
    public readonly operation: string,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(
      `"${operation}" failed after ${attempts} attempt(s): ${lastError.message}`,
    );
    this.name = 'RpcExhaustedError';
  }
}

/**
 * withRetry — exponential-backoff retry engine.
 *
 * Backoff schedule (defaults):
 *   Attempt 1 → immediate
 *   Attempt 2 → ~1 000 ms
 *   Attempt 3 → ~2 000 ms
 *   Attempt 4 → ~4 000 ms  → throws RpcExhaustedError
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  logger?: Logger,
): Promise<T> {
  const {
    maxAttempts = 4,
    baseDelayMs = 1_000,
    factor = 2,
    maxDelayMs = 30_000,
    jitter = 0.2,
    operationName = 'operation',
  } = options;

  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxAttempts) break;

      const raw = Math.min(
        baseDelayMs * Math.pow(factor, attempt - 1),
        maxDelayMs,
      );
      const delay = Math.max(
        0,
        Math.round(raw + raw * jitter * (Math.random() * 2 - 1)),
      );

      logger?.warn(
        `[${operationName}] attempt ${attempt}/${maxAttempts} failed — ` +
          `retrying in ${delay}ms. Reason: ${lastError.message}`,
      );

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new RpcExhaustedError(operationName, maxAttempts, lastError);
}

// ─── Retryable method decorator ─────────────────────────────────────────────

/**
 * @Retryable(maxAttempts) — decorates any async method with retry + backoff.
 *
 * @example
 * @Retryable(3)
 * async fetchPrice(token: string): Promise<number> { ... }
 *
 * @example
 * @Retryable({ maxAttempts: 5, baseDelayMs: 500 })
 * async callSorobanRpc(): Promise<string> { ... }
 */
export function Retryable(optionsOrAttempts: number | RetryOptions) {
  const options: RetryOptions =
    typeof optionsOrAttempts === 'number'
      ? { maxAttempts: optionsOrAttempts }
      : optionsOrAttempts;

  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const className = target.constructor?.name ?? 'Unknown';
    const operationName =
      options.operationName ?? `${className}.${propertyKey}`;

    descriptor.value = async function (...args: unknown[]) {
      // Use the instance logger if available (NestJS services have this.logger)
      const logger: Logger | undefined = (this as { logger?: Logger }).logger;
      return withRetry(
        () => original.apply(this, args),
        { ...options, operationName },
        logger,
      );
    };

    Object.defineProperty(descriptor.value, 'name', { value: propertyKey });
    return descriptor;
  };
}

// ─── DexScreener response shape ─────────────────────────────────────────────

interface DexScreenerResponse {
  pairs: Array<{
    priceUsd: string;
    baseToken: { symbol: string };
    volume: { h24: number };
    liquidity: { usd: number };
  }>;
}

// ─── GeckoTerminal response shape (BE-01 fallback fetcher) ─────────────────

interface GeckoTerminalResponse {
  data?: {
    attributes?: {
      token_prices?: Record<string, string>;
    };
  };
}

/** Thrown when both DexScreener and GeckoTerminal are exhausted. */
export class PriceFeedOutageError extends Error {
  constructor(
    public readonly tokenAddress: string,
    public readonly dexScreenerError: Error,
    public readonly geckoTerminalError: Error,
  ) {
    super(
      `All price feeds exhausted for ${tokenAddress}. ` +
        `DexScreener: ${dexScreenerError.message}; GeckoTerminal: ${geckoTerminalError.message}`,
    );
    this.name = 'PriceFeedOutageError';
  }
}

export interface EvidencePayload {
  callId: number;
  tokenAddress: string;
  chain: string;
  source: 'dexscreener' | 'geckoterminal';
  price: number;
  scaledPrice: string;
  outcome: boolean;
  conditionJson: unknown;
  resolvedAt: string;
}

export interface ResolutionResult {
  callId: number;
  status: 'SETTLED' | 'UNRESOLVED';
  outcome?: boolean;
  finalPrice?: number;
  evidenceCid?: string;
  oracleSignature?: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);

  private signer: ethers.Wallet;
  private stellarKeypair: Keypair;

  /** KMS/local abstraction used by signEIP712() — see key-signer.ts (BE-02). */
  private activeSigner?: IKeySigner;

  constructor(
    private configService: ConfigService,
    private adminService: AdminService,
    @Optional() private readonly ipfsService?: IpfsService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional()
    @InjectRepository(Call)
    private readonly callRepository?: Repository<Call>,
    @Optional()
    @InjectRepository(AuditLog)
    private readonly auditLogRepository?: Repository<AuditLog>,
    @Optional() private readonly dataSource?: DataSource,
  ) {
    const privateKey = this.configService.get<string>('ORACLE_PRIVATE_KEY');
    if (privateKey) {
      this.signer = new ethers.Wallet(privateKey);
    }

    const stellarSecretKey = this.configService.get<string>(
      'STELLAR_ORACLE_SECRET_KEY',
    );
    if (stellarSecretKey) {
      this.stellarKeypair = Keypair.fromSecret(stellarSecretKey);
    }

    const kmsUrl = this.configService.get<string>('KMS_URL');
    if (kmsUrl) {
      this.activeSigner = new KmsSigner(
        kmsUrl,
        this.configService.get<string>('KMS_KEY_ID', ''),
        this.configService.get<string>('KMS_API_TOKEN'),
      );
    } else if (privateKey) {
      this.activeSigner = new LocalWalletSigner(privateKey);
    }
  }

  // ─── Public key helpers ───────────────────────────────────────────────────

  /**
   * Get the Stellar public key for contract authorization.
   */
  getStellarPublicKey(): string {
    if (!this.stellarKeypair) {
      throw new Error('Stellar keypair not configured');
    }
    return this.stellarKeypair.publicKey();
  }

  // ─── Price fetching ───────────────────────────────────────────────────────

  /**
   * Fetches the USD price for a token via the DexScreener API.
   *
   * Retried automatically with exponential backoff:
   *   attempt 1 → immediate
   *   attempt 2 → ~1 s
   *   attempt 3 → ~2 s
   *   attempt 4 → ~4 s → throws RpcExhaustedError
   *
   * Logs a warning on each failed attempt and only throws after all
   * attempts are exhausted.
   */
  @Retryable({
    maxAttempts: 4,
    baseDelayMs: 1_000,
    operationName: 'oracle:fetchPrice',
  })
  async fetchPrice(tokenAddress: string): Promise<number> {
    this.logger.log(`Fetching price for ${tokenAddress}`);

    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000), // 8 s hard timeout per attempt
    });

    if (!response.ok) {
      throw new Error(
        `DexScreener responded ${response.status} ${response.statusText} for ${tokenAddress}`,
      );
    }

    const data = (await response.json()) as DexScreenerResponse;

    const pair = data?.pairs?.[0];
    if (!pair?.priceUsd) {
      throw new Error(
        `No price data returned by DexScreener for ${tokenAddress}`,
      );
    }

    const price = parseFloat(pair.priceUsd);
    this.logger.log(
      `Price fetched for ${tokenAddress}: $${price} ` +
        `(${pair.baseToken.symbol}, 24h vol: $${pair.volume.h24})`,
    );

    return price;
  }

  /**
   * Fetch price with a graceful fallback — returns null instead of throwing
   * when all retry attempts are exhausted. Use this when a missing price should
   * degrade gracefully rather than crash the caller.
   */
  async fetchPriceSafe(tokenAddress: string): Promise<number | null> {
    try {
      return await this.fetchPrice(tokenAddress);
    } catch (err) {
      if (err instanceof RpcExhaustedError) {
        this.logger.error(
          `oracle:fetchPrice exhausted after ${err.attempts} attempts for ` +
            `${tokenAddress} — ${err.lastError.message}`,
        );
        return null;
      }
      throw err;
    }
  }

  /**
   * Fetches the USD price for a token via GeckoTerminal's simple price API.
   * Used as the fallback fetcher when DexScreener is unavailable (BE-01).
   */
  @Retryable({
    maxAttempts: 3,
    baseDelayMs: 1_000,
    operationName: 'oracle:fetchFromGeckoTerminal',
  })
  async fetchFromGeckoTerminal(
    tokenAddress: string,
    network?: string,
  ): Promise<number> {
    const net =
      network ??
      this.configService.get<string>('GECKOTERMINAL_NETWORK', 'base');
    const url = `https://api.geckoterminal.com/api/v2/simple/networks/${net}/token_price/${tokenAddress}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(
        `GeckoTerminal responded ${response.status} ${response.statusText} for ${tokenAddress}`,
      );
    }

    const data = (await response.json()) as GeckoTerminalResponse;
    const prices = data?.data?.attributes?.token_prices;
    const raw = prices?.[tokenAddress.toLowerCase()] ?? prices?.[tokenAddress];

    if (!raw) {
      throw new Error(
        `No price data returned by GeckoTerminal for ${tokenAddress}`,
      );
    }

    const price = parseFloat(raw);
    this.logger.log(
      `GeckoTerminal fallback price for ${tokenAddress}: $${price}`,
    );
    return price;
  }

  /**
   * DexScreener → GeckoTerminal fallback chain (BE-01).
   *
   * Tries DexScreener first (already retried internally by @Retryable).
   * If DexScreener's retries are exhausted, falls back to GeckoTerminal
   * (also retried). Only throws PriceFeedOutageError once *both* feeds
   * are exhausted, which callers should treat as an UNRESOLVED signal.
   */
  async fetchPriceWithFallback(
    tokenAddress: string,
    network?: string,
  ): Promise<{ price: number; source: 'dexscreener' | 'geckoterminal' }> {
    try {
      const price = await this.fetchPrice(tokenAddress);
      return { price, source: 'dexscreener' };
    } catch (dexErr) {
      const dexError =
        dexErr instanceof Error ? dexErr : new Error(String(dexErr));
      this.logger.warn(
        `DexScreener exhausted for ${tokenAddress}, falling back to GeckoTerminal: ${dexError.message}`,
      );

      try {
        const price = await this.fetchFromGeckoTerminal(tokenAddress, network);
        return { price, source: 'geckoterminal' };
      } catch (geckoErr) {
        const geckoError =
          geckoErr instanceof Error ? geckoErr : new Error(String(geckoErr));
        throw new PriceFeedOutageError(tokenAddress, dexError, geckoError);
      }
    }
  }

  /** Scales a USD float price into an integer string per ORACLE_PRICE_SCALE (default 1e18). */
  scalePrice(price: number): string {
    const scale = BigInt(
      this.configService.get<string>(
        'ORACLE_PRICE_SCALE',
        '1000000000000000000',
      ),
    );
    // Work in integer cents-of-scale to avoid floating point drift, then
    // apply the remaining scale as a BigInt multiplication.
    const PRECISION = 1_000_000; // 6 decimal places of the input float
    const scaledFloat = BigInt(Math.round(price * PRECISION));
    return ((scaledFloat * scale) / BigInt(PRECISION)).toString();
  }

  // ─── Call resolution orchestrator (BE-01) ──────────────────────────────────

  /**
   * Resolves every due call (`status = 'OPEN' AND endTs <= now()`), one
   * database row at a time, guarded by `FOR UPDATE SKIP LOCKED` so multiple
   * OracleService instances/replicas can run this sweep concurrently
   * without double-settling a call.
   *
   * For each due call:
   *   1. Fetch price via DexScreener → GeckoTerminal fallback.
   *      - On total outage: mark UNRESOLVED, notify admins, audit-log, continue.
   *   2. Determine outcome from `conditionJson` (`{ direction, targetPrice }`).
   *   3. Pin an evidence JSON blob to IPFS.
   *   4. Sign the outcome for the call's chain (EIP-712 or ed25519).
   *   5. Persist SETTLED + emit `oracle.settlement`.
   */
  async resolveDueCalls(batchSize?: number): Promise<ResolutionResult[]> {
    if (!this.dataSource || !this.callRepository) {
      throw new Error(
        'OracleService.resolveDueCalls requires DataSource and Call repository to be injected',
      );
    }

    const limit =
      batchSize ??
      this.configService.get<number>('ORACLE_RESOLUTION_BATCH_SIZE', 20);

    const results: ResolutionResult[] = [];

    await this.dataSource.transaction(async (manager) => {
      const dueRows: Call[] = await manager.query(
        `SELECT * FROM "call"
           WHERE status = 'OPEN' AND "endTs" <= NOW()
           ORDER BY "endTs" ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      for (const row of dueRows) {
        const call = manager.create(Call, row);
        // Claim the row immediately so a crash mid-loop doesn't leave it
        // silently re-picked as OPEN by the next sweep.
        call.status = 'SETTLING';
        await manager.save(Call, call);

        try {
          const result = await this.resolveOneCall(call, manager);
          results.push(result);
        } catch (err) {
          this.logger.error(
            `Unexpected error resolving call ${call.id}: ${(err as Error).message}`,
          );
          call.status = 'UNRESOLVED';
          await manager.save(Call, call);
          await this.recordUnresolved(call, err as Error, manager);
          results.push({ callId: call.id, status: 'UNRESOLVED' });
        }
      }
    });

    return results;
  }

  private async resolveOneCall(
    call: Call,
    manager: import('typeorm').EntityManager,
  ): Promise<ResolutionResult> {
    let priceResult: { price: number; source: 'dexscreener' | 'geckoterminal' };
    try {
      priceResult = await this.fetchPriceWithFallback(call.tokenAddress);
    } catch (err) {
      call.status = 'UNRESOLVED';
      await manager.save(Call, call);
      await this.recordUnresolved(call, err as Error, manager);
      return { callId: call.id, status: 'UNRESOLVED' };
    }

    const { price, source } = priceResult;
    const outcome = this.determineOutcome(call, price);
    const scaledPrice = this.scalePrice(price);

    const evidence: EvidencePayload = {
      callId: call.id,
      tokenAddress: call.tokenAddress,
      chain: call.chain,
      source,
      price,
      scaledPrice,
      outcome,
      conditionJson: call.conditionJson,
      resolvedAt: new Date().toISOString(),
    };

    let evidenceCid: string | undefined;
    if (this.ipfsService) {
      try {
        evidenceCid = await this.ipfsService.pin(
          Buffer.from(JSON.stringify(evidence, null, 2)),
          `evidence-call-${call.id}.json`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to pin evidence for call ${call.id}: ${(err as Error).message}`,
        );
      }
    }

    const timestamp = Math.floor(Date.now() / 1000);
    let oracleSignature: string | undefined;
    try {
      if (call.chain === 'stellar') {
        oracleSignature = this.signEd25519(
          call.id,
          outcome,
          price,
          timestamp,
        ).signatureHex;
      } else {
        // Pass the scaled price as a string (not Number()) — 1e18-scaled
        // uint256 values routinely exceed Number.isSafeInteger, and ethers'
        // typed-data encoder rejects lossy numeric conversions.
        oracleSignature = await this.signEIP712(
          call.id,
          outcome,
          scaledPrice,
          timestamp,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to sign outcome for call ${call.id}: ${(err as Error).message}`,
      );
    }

    call.status = 'SETTLED';
    call.outcome = outcome;
    call.finalPrice = price;
    call.evidenceCid = evidenceCid ?? call.evidenceCid;
    call.oracleSignature = oracleSignature ?? call.oracleSignature;
    await manager.save(Call, call);

    if (this.auditLogRepository) {
      await manager.save(AuditLog, {
        action: AuditLogAction.ORACLE_SETTLEMENT,
        actor: 'oracle-worker',
        targetResource: `call:${call.id}`,
        payload: { outcome, price, scaledPrice, source },
        evidenceCid,
        chain: call.chain,
      });
    }

    this.eventEmitter?.emit('oracle.settlement', {
      callId: call.id,
      chain: call.chain,
      outcome,
      finalPrice: price,
      scaledPrice,
      evidenceCid,
      oracleSignature,
      source,
    });

    return {
      callId: call.id,
      status: 'SETTLED',
      outcome,
      finalPrice: price,
      evidenceCid,
      oracleSignature,
    };
  }

  /**
   * Determines the boolean outcome for a call given the resolved price.
   * Reads `{ direction: 'above' | 'below', targetPrice: number }` from
   * `conditionJson` — the shape populated by the indexer from the call's
   * pinned IPFS metadata. Defaults to `false` if the condition is missing
   * or malformed, since an ambiguous condition should never resolve to a
   * false-positive "yes".
   */
  private determineOutcome(call: Call, price: number): boolean {
    const condition = call.conditionJson as
      | { direction?: 'above' | 'below'; targetPrice?: number }
      | undefined;

    if (!condition?.direction || typeof condition.targetPrice !== 'number') {
      this.logger.warn(
        `Call ${call.id} has no usable conditionJson — defaulting outcome to false`,
      );
      return false;
    }

    return condition.direction === 'above'
      ? price >= condition.targetPrice
      : price <= condition.targetPrice;
  }

  private async recordUnresolved(
    call: Call,
    error: Error,
    manager: import('typeorm').EntityManager,
  ): Promise<void> {
    this.logger.error(`Call ${call.id} marked UNRESOLVED: ${error.message}`);

    if (this.auditLogRepository) {
      await manager.save(AuditLog, {
        action: AuditLogAction.ORACLE_UNRESOLVED,
        actor: 'oracle-worker',
        targetResource: `call:${call.id}`,
        payload: { reason: error.message },
        chain: call.chain,
      });
    }

    this.eventEmitter?.emit('oracle.unresolved', {
      callId: call.id,
      chain: call.chain,
      reason: error.message,
    });

    await this.notifyAdmin(call, error);
  }

  /** Sends a best-effort admin alert on total price-feed outage (BE-01). */
  private async notifyAdmin(call: Call, error: Error): Promise<void> {
    const webhookUrl = this.configService.get<string>(
      'DISCORD_ADMIN_WEBHOOK_URL',
    );
    const message =
      `🚨 **Oracle Resolution Failed** 🚨\n` +
      `Call ID: ${call.id} could not be resolved and was marked **UNRESOLVED**.\n` +
      `Reason: ${error.message}`;

    if (!webhookUrl) {
      this.logger.warn(`No DISCORD_ADMIN_WEBHOOK_URL configured. ${message}`);
      return;
    }

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message }),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send admin notification for call ${call.id}: ${(err as Error).message}`,
      );
    }
  }

  // ─── EVM (EIP-712) signing ────────────────────────────────────────────────

  /**
   * Signs an outcome with EIP-712 through the active key signer (local
   * wallet or KMS — see key-signer.ts). This is the BE-02 entry point;
   * `signOutcome()` below is kept as-is for backward compatibility with
   * existing callers/tests.
   */
  async signEIP712(
    callId: number,
    outcome: boolean,
    finalPrice: number | string | bigint,
    timestamp: number,
  ): Promise<string> {
    if (this.adminService.isPaused()) {
      throw new ServiceUnavailableException(
        'Protocol is paused. Oracle signatures are disabled.',
      );
    }
    if (!this.activeSigner) {
      throw new Error(
        'Oracle signer not configured (no ORACLE_PRIVATE_KEY or KMS_URL)',
      );
    }

    const domain = {
      name: 'OnChainSageOutcome',
      version: '1',
      chainId: this.configService.get<number>('ORACLE_CHAIN_ID', 8453),
      verifyingContract: this.configService.get<string>(
        'OUTCOME_MANAGER_ADDRESS',
      ),
    };

    const types = {
      Outcome: [
        { name: 'callId', type: 'uint256' },
        { name: 'outcome', type: 'bool' },
        { name: 'finalPrice', type: 'uint256' },
        { name: 'timestamp', type: 'uint256' },
      ],
    };

    const value = { callId, outcome, finalPrice, timestamp };

    return this.activeSigner.signTypedData(domain, types, value);
  }

  /**
   * Rotates the active signing key (BE-02). Callers must gate this behind
   * an admin-only, multisig-guarded route (see AdminController + AdminGuard).
   *
   *   - LocalWalletSigner: pass a new 0x-prefixed private key.
   *   - KmsSigner: pass a new key alias/id — the private key itself never
   *     transits through this process.
   */
  async rotateOracleKey(newKeyMaterial: string): Promise<{ address: string }> {
    if (!this.activeSigner) {
      throw new Error('No active signer configured to rotate');
    }

    if (this.activeSigner instanceof LocalWalletSigner) {
      this.activeSigner.rotate(newKeyMaterial);
    } else if (this.activeSigner instanceof KmsSigner) {
      this.activeSigner.rotate(newKeyMaterial);
    }

    const address = await this.activeSigner.getAddress();

    if (this.auditLogRepository) {
      await this.auditLogRepository.save(
        this.auditLogRepository.create({
          action: AuditLogAction.ORACLE_KEY_ROTATED,
          actor: 'admin',
          targetResource: 'oracle-signer',
          payload: { newAddress: address, signerKind: this.activeSigner.kind },
        }),
      );
    }

    this.eventEmitter?.emit('oracle.key.rotated', {
      address,
      signerKind: this.activeSigner.kind,
    });

    return { address };
  }

  async signOutcome(
    callId: number,
    outcome: boolean,
    finalPrice: number,
    timestamp: number,
  ): Promise<string> {
    if (this.adminService.isPaused()) {
      throw new ServiceUnavailableException(
        'Protocol is paused. Oracle signatures are disabled.',
      );
    }
    if (!this.signer) throw new Error('Oracle signer not configured');

    const domain = {
      name: 'OnChainSageOutcome',
      version: '1',
      chainId: 84532, // Base Sepolia
      verifyingContract: this.configService.get<string>(
        'OUTCOME_MANAGER_ADDRESS',
      ),
    };

    const types = {
      Outcome: [
        { name: 'callId', type: 'uint256' },
        { name: 'outcome', type: 'bool' },
        { name: 'finalPrice', type: 'uint256' },
        { name: 'timestamp', type: 'uint256' },
      ],
    };

    const value = { callId, outcome, finalPrice, timestamp };

    return this.signer.signTypedData(domain, types, value);
  }

  // ─── Stellar (ed25519) signing ────────────────────────────────────────────

  /**
   * Sign outcome with ed25519 for Stellar/Soroban verification.
   *
   * Message format: BackIt:Outcome:{callId}:{outcome}:{finalPrice}:{timestamp}
   *   - callId:     unique identifier for the call
   *   - outcome:    'true' or 'false' (as string)
   *   - finalPrice: the final price as a number
   *   - timestamp:  unix timestamp in seconds
   *
   * @returns 64-byte Buffer (compatible with Soroban BytesN<64>)
   */
  signStellarOutcome(
    callId: number,
    outcome: boolean,
    finalPrice: number,
    timestamp: number,
  ): Buffer {
    if (this.adminService.isPaused()) {
      throw new ServiceUnavailableException(
        'Protocol is paused. Oracle signatures are disabled.',
      );
    }
    if (!this.stellarKeypair) {
      throw new Error('Stellar keypair not configured');
    }

    // Must match exactly what the Soroban contract expects
    const message = `BackIt:Outcome:${callId}:${outcome}:${finalPrice}:${timestamp}`;
    const messageBuffer = Buffer.from(message, 'utf-8');

    return this.stellarKeypair.sign(messageBuffer);
  }

  // ─── Stellar (tweetnacl ed25519) signing — BE-03 ──────────────────────────

  /**
   * Builds the canonical outcome message signed for Stellar/Soroban
   * verification: `BackIt:Outcome:{callId}:{0|1}:{finalPrice}:{timestamp}`.
   *
   * Outcome is encoded as `0`/`1` (not `true`/`false`) to match the exact
   * byte layout the Soroban `outcome_manager` contract reconstructs and
   * verifies on-chain.
   */
  buildStellarMessage(
    callId: number,
    outcome: boolean,
    finalPrice: number,
    timestamp: number,
  ): string {
    return `BackIt:Outcome:${callId}:${outcome ? 1 : 0}:${finalPrice}:${timestamp}`;
  }

  /**
   * Signs a Stellar outcome using `tweetnacl.sign.detached` directly (BE-03),
   * rather than going through the Stellar SDK's `Keypair.sign` wrapper.
   * Returns hex-encoded signature (BytesN<64>) and public key (BytesN<32>)
   * ready to hand to the Soroban contract call.
   */
  signEd25519(
    callId: number,
    outcome: boolean,
    finalPrice: number,
    timestamp: number,
  ): { signatureHex: string; publicKeyHex: string; message: string } {
    if (this.adminService.isPaused()) {
      throw new ServiceUnavailableException(
        'Protocol is paused. Oracle signatures are disabled.',
      );
    }
    if (!this.stellarKeypair) {
      throw new Error('Stellar keypair not configured');
    }

    const message = this.buildStellarMessage(
      callId,
      outcome,
      finalPrice,
      timestamp,
    );
    const messageBytes = Buffer.from(message, 'utf-8');

    // rawSecretKey() returns the 32-byte ed25519 seed; tweetnacl derives the
    // full 64-byte secret key (seed + public key) from it.
    const seed = this.stellarKeypair.rawSecretKey();
    const naclKeyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));

    const signature = nacl.sign.detached(
      new Uint8Array(messageBytes),
      naclKeyPair.secretKey,
    );

    return {
      signatureHex: Buffer.from(signature).toString('hex'),
      publicKeyHex: Buffer.from(naclKeyPair.publicKey).toString('hex'),
      message,
    };
  }

  /** Verifies a signature produced by signEd25519() — used in tests and admin tooling. */
  verifyEd25519(
    message: string,
    signatureHex: string,
    publicKeyHex: string,
  ): boolean {
    return nacl.sign.detached.verify(
      new Uint8Array(Buffer.from(message, 'utf-8')),
      new Uint8Array(Buffer.from(signatureHex, 'hex')),
      new Uint8Array(Buffer.from(publicKeyHex, 'hex')),
    );
  }

  /**
   * Sign outcome based on chain type.
   * Automatically selects EIP-712 (EVM/Base) or ed25519 (Stellar) signing.
   *
   * @param chain       - 'base' or 'stellar'
   * @param callId      - unique call identifier
   * @param outcome     - whether the outcome was successful
   * @param finalPrice  - final price value
   * @param timestamp   - unix timestamp when the outcome was determined
   * @returns hex string (EVM) or base64 string (Stellar)
   */
  async signOutcomeForChain(
    chain: 'base' | 'stellar',
    callId: number,
    outcome: boolean,
    finalPrice: number,
    timestamp: number,
  ): Promise<string> {
    if (chain === 'stellar') {
      const signature = this.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );
      return signature.toString('base64');
    }

    return this.signOutcome(callId, outcome, finalPrice, timestamp);
  }
}
