import { registerAs } from '@nestjs/config';

/**
 * Stellar RPC endpoint and resilience configuration (BE-007).
 *
 * Every threshold is env-tunable: the right error rate or probe interval
 * depends on which RPC provider is in front of the indexer, and that should
 * not require a redeploy of code to change.
 */
export interface StellarRpcConfig {
  /** Primary Soroban RPC endpoint. */
  primaryUrl: string;
  /** Ordered fallbacks, tried in sequence when the primary is open. */
  fallbackUrls: string[];
  /** How often to probe endpoint health, in ms. */
  probeIntervalMs: number;
  /** Per-probe timeout, in ms. */
  probeTimeoutMs: number;
  /** Error percentage that trips the breaker. */
  errorThresholdPercentage: number;
  /** How long the breaker stays open before a half-open trial, in ms. */
  resetTimeoutMs: number;
  /** Minimum calls in a window before the error rate is allowed to trip. */
  volumeThreshold: number;
  /**
   * How far behind the furthest-ahead endpoint a node may be before it is
   * considered unhealthy, in ledgers. A node that answers promptly but is
   * stuck 200 ledgers back is worse than useless for indexing: it returns
   * confidently stale data.
   */
  maxLedgerLag: number;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toUrlList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

export const stellarConfig = registerAs(
  'stellar',
  (): StellarRpcConfig => ({
    primaryUrl:
      process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    fallbackUrls: toUrlList(process.env.SOROBAN_RPC_FALLBACK_URLS),
    probeIntervalMs: toInt(process.env.SOROBAN_RPC_PROBE_INTERVAL_MS, 10_000),
    probeTimeoutMs: toInt(process.env.SOROBAN_RPC_PROBE_TIMEOUT_MS, 3_000),
    errorThresholdPercentage: toInt(
      process.env.SOROBAN_RPC_ERROR_THRESHOLD_PCT,
      20,
    ),
    resetTimeoutMs: toInt(process.env.SOROBAN_RPC_RESET_TIMEOUT_MS, 30_000),
    volumeThreshold: toInt(process.env.SOROBAN_RPC_VOLUME_THRESHOLD, 5),
    maxLedgerLag: toInt(process.env.SOROBAN_RPC_MAX_LEDGER_LAG, 100),
  }),
);
