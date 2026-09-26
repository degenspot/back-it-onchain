import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { BulkIngestConfig } from '../../config/bulk-ingest.config';
import type {
  BulkUpsertResult,
  UpsertCallEventInput,
} from './call-event-store.service';
import { CallEventStoreService } from './call-event-store.service';

/** Injection token for the bulk writer. Optional so tests can substitute it. */
export const BULK_EVENT_WRITER = Symbol('BULK_EVENT_WRITER');

/** The subset of CallEventStoreService this loader depends on. */
export type BulkEventWriter = Pick<
  CallEventStoreService,
  'bulkUpsertEvents'
>;

export interface BulkEventLoaderOptions {
  batchSize?: number;
  maxLatencyMs?: number;
  maxRowsPerStatement?: number;
  maxConcurrency?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface BulkIngestStats {
  /** Events accepted into the buffer and not yet confirmed written. */
  buffered: number;
  /** Events accepted over the loader's lifetime. */
  enqueued: number;
  /** Events confirmed written to the database. */
  inserted: number;
  /** Events that turned out to already exist in the database. */
  duplicatesSkipped: number;
  /** Flushes performed. */
  flushes: number;
  /** Flushes that failed and were retried by the caller. */
  failedFlushes: number;
  /** Flushes skipped because a flush was already in progress. */
  coalescedFlushes: number;
  /** Rows written per second, averaged over the loader's lifetime. */
  throughputPerSecond: number;
  /** Wall-clock ms since the loader was initialised. */
  uptimeMs: number;
}

const EMPTY_STATS: BulkIngestStats = {
  buffered: 0,
  enqueued: 0,
  inserted: 0,
  duplicatesSkipped: 0,
  flushes: 0,
  failedFlushes: 0,
  coalescedFlushes: 0,
  throughputPerSecond: 0,
  uptimeMs: 0,
};

/**
 * BulkEventLoaderService — BE-008.
 *
 * The high-throughput ingest path for catching up historical ledgers.
 *
 * Writing an event is not expensive in itself; the round trip is. At ~2ms of
 * network plus planner overhead, one `findOne` + `save` per event caps ingest
 * at a few hundred events per second no matter how fast the database is. A
 * catch-up over hundreds of thousands of ledgers is therefore latency-bound,
 * not throughput-bound, and the fix is to stop paying that cost per event.
 *
 * This service sits in front of {@link CallEventStoreService.bulkUpsertEvents}
 * and turns a stream of individual events into large, infrequent writes:
 *
 *   - Events accumulate in an in-memory buffer and are flushed when *either*
 *     the buffer reaches `batchSize` (default 5,000) *or* `maxLatencyMs`
 *     elapses (default 500ms). Both triggers are necessary. Size alone would
 *     stall ingest during a historical backfill that trickles events in; time
 *     alone would issue a tiny statement per event during exactly the burst we
 *     are trying to batch. Whichever fires first wins, so throughput is high
 *     under load and freshness is bounded under trickle.
 *
 *   - `enqueue` is synchronous and never blocks on I/O. The caller — an RPC
 *     poll loop parsing a ledger — is not made to wait for the database, which
 *     is what lets the parser stay ahead of the writer.
 *
 *   - At most one flush is in flight at a time. Producers keep enqueueing into
 *     a fresh buffer while a flush runs, and the next flush picks up whatever
 *     accumulated. Without this, a slow database would let flushes pile up
 *     without bound and the buffer would grow until the process died; with it,
 *     memory is capped at roughly one batch plus whatever arrives during a
 *     single flush.
 *
 *   - The buffer is a plain array that is drained by handing its contents to
 *     the writer and immediately replaced. No queue, no retained references,
 *     nothing that grows over a multi-hour sync run.
 *
 *   - Because the underlying write is `ON CONFLICT DO NOTHING`, re-delivering
 *     a batch is a no-op. A crash mid-flush, a retry, or an overlapping poll
 *     window cannot produce duplicate rows.
 */
@Injectable()
export class BulkEventLoaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BulkEventLoaderService.name);

  private buffer: UpsertCallEventInput[] = [];
  private flushTimer?: NodeJS.Timeout;
  /** Serialises every flush so only one write path touches the buffer. */
  private flushChain: Promise<void> = Promise.resolve();
  private writesInProgress = 0;
  private startedAt = 0;
  private stopped = false;

  private options: Required<BulkEventLoaderOptions> = {
    batchSize: 5_000,
    maxLatencyMs: 500,
    maxRowsPerStatement: 1_000,
    maxConcurrency: 2,
    maxRetries: 3,
    retryDelayMs: 250,
  };

  private readonly stats: BulkIngestStats = { ...EMPTY_STATS };

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(BULK_EVENT_WRITER)
    private readonly writer?: BulkEventWriter,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.options = this.resolveOptions();
    this.startedAt = Date.now();

    this.logger.log(
      `Bulk event loader ready: flush at ${this.options.batchSize} events or ` +
        `${this.options.maxLatencyMs}ms, ${this.options.maxRowsPerStatement} ` +
        `rows/statement, concurrency ${this.options.maxConcurrency}`,
    );
  }

  /**
   * Flushes whatever is buffered on shutdown. A run stopped mid-catch-up
   * should not silently discard the tail it had already parsed.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.clearTimer();
    await this.flush('shutdown');
  }

  /**
   * Applies explicit options over the resolved configuration. Exposed for
   * tests and for callers that want a one-off batch size; values left
   * `undefined` fall back to configuration.
   */
  configure(overrides: BulkEventLoaderOptions = {}): void {
    this.options = { ...this.options, ...stripUndefined(overrides) };
    // Re-arm so a shortened maxLatencyMs takes effect on the events already
    // waiting rather than only on the next one.
    if (this.buffer.length > 0) {
      this.clearTimer();
      this.armTimer();
    }
    this.logger.debug(
      `Bulk event loader reconfigured: ${JSON.stringify(this.options)}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ingest
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Buffers one event. Returns immediately — it never awaits the database, so
   * a slow write applies backpressure by filling the buffer (and therefore
   * lengthening the next batch) rather than by stalling the producer.
   */
  enqueue(event: UpsertCallEventInput): void {
    if (this.stopped) {
      this.logger.warn(
        'Dropping event: bulk loader is shutting down. Flush before stopping.',
      );
      return;
    }

    this.buffer.push(event);
    this.stats.enqueued += 1;
    this.armTimer();

    if (this.buffer.length >= this.options.batchSize) {
      void this.flush('batch-size');
    }
  }

  /**
   * Buffers many events at once, for a caller holding a whole RPC page.
   *
   * Appended one at a time rather than with a single `push(...events)` so that
   * the `batchSize` contract still holds: a 500k-event page becomes a sequence
   * of 5,000-event flushes instead of one enormous buffer. The size check
   * inside the loop matters for the same reason — a single check after a bulk
   * `push` would only ever fire once, at the end.
   */
  enqueueMany(events: UpsertCallEventInput[]): void {
    if (this.stopped) return;

    for (const event of events) {
      this.enqueue(event);
    }
  }

  /**
   * Writes everything currently buffered and resolves once it is durable.
   *
   * The guarantee is precise: when the returned promise resolves, every event
   * that was in the buffer at the moment `flush` was called has been written.
   * Events that arrive afterwards belong to the next batch and may still be
   * buffered — call `flush` again, or rely on the size/latency triggers.
   *
   * Concurrent callers are safe. The buffer is taken synchronously, so two
   * calls can never claim the same event, and the writes are chained so they
   * execute one at a time instead of stampeding the pool.
   */
  flush(reason: string = 'manual'): Promise<BulkUpsertResult | null> {
    this.clearTimer();
    this.stats.coalescedFlushes += 1;

    // Swap the buffer out synchronously, before anything is awaited. Producers
    // can start filling the next batch on the very next line, and no event can
    // ever be appended to the array a write is already iterating. Deferring the
    // swap into a `.then` would leave the whole batch pinned in the buffer for
    // an extra microtask per link in the chain.
    const batch = this.buffer;
    this.buffer = [];

    // Nothing to write. Still chain onto the tail so the caller resumes only
    // after any write already in flight has finished — `flush()` is documented
    // to mean "everything buffered before this call is durable", and returning
    // early without waiting would break that for the caller that just wants to
    // be sure the backlog cleared.
    if (batch.length === 0) {
      return this.flushChain.then(() => null);
    }

    // The writes themselves are serialised, not the buffer swaps. Without this,
    // a burst of `enqueueMany` calls would queue a flush per batch and they
    // would all hit the database at once — the opposite of what this service
    // exists to do. Chaining the writes keeps at most one statement in flight
    // per loader while the buffer keeps turning over freely.
    const run = this.flushChain.then(() => this.write(batch, reason));

    // The chain itself must never reject, or every later flush would inherit the
    // rejection and none would ever run again. `write` already swallows its
    // errors; this is belt-and-braces so an unexpected throw cannot poison the
    // chain for the life of the process.
    this.flushChain = run.then(
      () => undefined,
      () => undefined,
    );

    this.writesInProgress += 1;
    void run.finally(() => {
      this.writesInProgress -= 1;
    });

    return run;
  }

  /**
   * Ingests a batch and waits for it to be written. The single-call
   * convenience path for a caller that already has a whole page of events in
   * hand and does not want to reason about the buffer.
   */
  async ingest(
    events: UpsertCallEventInput[],
  ): Promise<BulkUpsertResult | null> {
    this.enqueueMany(events);
    return this.flush('ingest');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Introspection
  // ─────────────────────────────────────────────────────────────────────────

  getStats(): BulkIngestStats {
    const uptimeMs = this.startedAt === 0 ? 0 : Date.now() - this.startedAt;
    return {
      ...this.stats,
      buffered: this.buffer.length,
      uptimeMs,
      throughputPerSecond:
        uptimeMs > 0
          ? Math.round((this.stats.inserted / uptimeMs) * 1000)
          : 0,
    };
  }

  /**
   * True while a write is actually running. A flush that is merely queued
   * behind an in-flight one does not count.
   */
  isFlushing(): boolean {
    return this.writesInProgress > 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Hands one batch to the writer and folds the result into the counters.
   *
   * A failure here is logged and counted rather than thrown: the batch was
   * already removed from the buffer, and propagating would turn a transient
   * database error into an unhandled rejection from the timer-driven flush
   * (which has no caller to receive it). Since the write is idempotent the
   * range can simply be re-driven.
   */
  private async write(
    batch: UpsertCallEventInput[],
    reason: string,
  ): Promise<BulkUpsertResult | null> {
    const writer = this.writer;
    if (!writer) {
      this.logger.error(
        `No bulk event writer wired up; discarding ${batch.length} event(s) ` +
          `buffered for reason "${reason}".`,
      );
      this.stats.failedFlushes += 1;
      return null;
    }

    try {
      const result = await writer.bulkUpsertEvents(batch, {
        maxRowsPerStatement: this.options.maxRowsPerStatement,
        maxConcurrency: this.options.maxConcurrency,
        maxRetries: this.options.maxRetries,
        retryDelayMs: this.options.retryDelayMs,
      });

      this.stats.flushes += 1;
      this.stats.inserted += result.inserted;
      this.stats.duplicatesSkipped += result.duplicatesSkipped;

      if (result.duplicatesSkipped > 0) {
        this.logger.debug(
          `Flush (${reason}): ${result.inserted} written, ` +
            `${result.duplicatesSkipped} already present`,
        );
      }
      return result;
    } catch (error) {
      this.stats.failedFlushes += 1;
      this.logger.error(
        `Flush (${reason}) of ${batch.length} event(s) failed: ${
          error instanceof Error ? error.message : String(error)
        }. The batch is idempotent and can be re-driven.`,
      );
      return null;
    }
  }

  /**
   * Arms the latency trigger.
   *
   * One timer covers the whole buffer rather than one per event, and it is
   * (re)armed whenever the buffer goes from empty to non-empty. An event that
   * arrives 400ms into the window therefore does not get its own extra 500ms
   * of latency: the deadline is measured from the oldest event waiting, which
   * is what the caller actually experiences.
   */
  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private armTimer(): void {
    if (this.flushTimer || this.stopped) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush('max-latency');
    }, this.options.maxLatencyMs);

    // Never hold the process open just to flush a buffer.
    this.flushTimer.unref?.();
  }

  private resolveOptions(): Required<BulkEventLoaderOptions> {
    const cfg = this.configService?.get<BulkIngestConfig>('bulkIngest');

    return {
      batchSize: positive(cfg?.batchSize, this.options.batchSize),
      maxLatencyMs: positive(cfg?.maxLatencyMs, this.options.maxLatencyMs),
      maxRowsPerStatement: positive(
        cfg?.maxRowsPerStatement,
        this.options.maxRowsPerStatement,
      ),
      maxConcurrency: positive(
        cfg?.maxConcurrency,
        this.options.maxConcurrency,
      ),
      maxRetries: positive(cfg?.maxRetries, this.options.maxRetries),
      retryDelayMs: positive(cfg?.retryDelayMs, this.options.retryDelayMs),
    };
  }
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0
    ? (value as number)
    : fallback;
}

function stripUndefined(
  options: BulkEventLoaderOptions,
): Partial<BulkEventLoaderOptions> {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  );
}
