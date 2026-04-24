import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { Keypair } from '@stellar/stellar-sdk';
import { AdminService } from '../admin/admin.service';

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

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);

  private signer: ethers.Wallet;
  private stellarKeypair: Keypair;

  constructor(
    private configService: ConfigService,
    private adminService: AdminService,
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

  // ─── EVM (EIP-712) signing ────────────────────────────────────────────────

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
