import { registerAs } from '@nestjs/config';

/**
 * High-throughput batch event ingest configuration (BE-008).
 *
 * Catching up a few hundred thousand historical ledgers event-by-event is
 * bound by round-trip latency, not by CPU: every event costs a SELECT plus an
 * INSERT on its own connection checkout. These knobs control how events are
 * accumulated before being written, and they are env-tunable because the right
 * values depend entirely on the deployment's database — a colocated Postgres
 * wants very large batches, a managed instance across a network link wants
 * smaller ones.
 */
export interface BulkIngestConfig {
  /**
   * Events buffered in memory before a flush is triggered. Larger batches mean
   * fewer round trips but a longer window where events are un-persisted.
   */
  batchSize: number;
  /**
   * Hard ceiling on how long an event may sit in the buffer, in ms. This is
   * what bounds the catch-up delay: even a trickle of events is flushed
   * within this window instead of waiting for the batch to fill.
   */
  maxLatencyMs: number;
  /**
   * Maximum rows folded into a single `INSERT ... ON CONFLICT DO NOTHING`
   * statement. Must stay under the PostgreSQL 65535 bind-parameter limit
   * (columns-per-row is 12, so the hard ceiling is ~5461); the default of
   * 1000 leaves generous headroom.
   */
  maxRowsPerStatement: number;
  /**
   * How many statements may be in flight at once. Each one borrows a
   * connection from the pool, so this should stay comfortably below the pool
   * size (pg defaults to 10) to avoid starving readers.
   */
  maxConcurrency: number;
  /**
   * How many times a failed statement is retried before the batch is
   * abandoned. Re-running a whole batch is safe because the write is
   * idempotent, so retries never duplicate rows.
   */
  maxRetries: number;
  /** Base delay for the exponential backoff between retries, in ms. */
  retryDelayMs: number;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const bulkIngestConfig = registerAs(
  'bulkIngest',
  (): BulkIngestConfig => ({
    batchSize: toInt(process.env.BULK_INGEST_BATCH_SIZE, 5_000),
    maxLatencyMs: toInt(process.env.BULK_INGEST_MAX_LATENCY_MS, 500),
    maxRowsPerStatement: toInt(process.env.BULK_INGEST_MAX_ROWS_PER_STATEMENT, 1_000),
    maxConcurrency: toInt(process.env.BULK_INGEST_MAX_CONCURRENCY, 2),
    maxRetries: toInt(process.env.BULK_INGEST_MAX_RETRIES, 3),
    retryDelayMs: toInt(process.env.BULK_INGEST_RETRY_DELAY_MS, 250),
  }),
);
