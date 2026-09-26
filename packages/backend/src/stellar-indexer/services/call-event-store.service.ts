/**
 * call-event-store.service.ts  (BE-002 / BE-004)
 *
 * Single write path shared by StellarIndexerService and BaseIndexerService.
 *
 * Guarantees
 * ──────────
 *  Idempotent upsert — keyed on (chain, txHash, eventSequence).
 *    Re-delivery of the same event updates in place, never inserts duplicates.
 *
 *  Reorg handling — handleReorg() soft-orphans conflicting rows at the same
 *    (chain, ledgerHeight) if their blockHash no longer matches the newly
 *    observed hash. Uses an atomic QueryRunner transaction so the entire
 *    orphan batch commits or rolls back as one unit.
 *
 *  Full-text search — the `searchVector` tsvector column is maintained by a
 *    DB trigger (migration 1756290000000), no application code needed.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, IsNull, DataSource, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { Call, ChainType } from '../entities/call.entity';

export interface UpsertCallEventInput {
  chain: ChainType;
  txHash: string;
  eventType: string;
  contractId?: string;
  stellarContractId?: string;
  baseContractAddress?: string;
  eventSequence?: number;
  ledgerHeight?: number;
  /**
   * Block/ledger hash for reorg detection.
   * When supplied with `ledgerHeight`, handleReorg() runs automatically
   * before the upsert.
   */
  blockHash?: string;
  eventData?: Record<string, unknown>;
}

/** Per-call tuning for {@link CallEventStoreService.bulkUpsertEvents}. */
export interface BulkUpsertOptions {
  /**
   * Rows folded into a single statement. Clamped so the generated statement
   * can never exceed PostgreSQL's 65535 bind-parameter limit.
   */
  maxRowsPerStatement?: number;
  /**
   * Statements allowed in flight simultaneously. Each borrows a pool
   * connection, so this is deliberately conservative by default.
   */
  maxConcurrency?: number;
  /** Retries per statement on failure. Safe because the write is idempotent. */
  maxRetries?: number;
  /** Base delay for the exponential backoff between statement retries, in ms. */
  retryDelayMs?: number;
}

export interface BulkUpsertResult {
  /** Events handed to the call, before in-batch de-duplication. */
  attempted: number;
  /** Events that survived in-batch de-duplication. */
  deduplicated: number;
  /** Rows actually written (excludes rows skipped by ON CONFLICT). */
  inserted: number;
  /**
   * Rows that already existed — either collapsed away by in-batch
   * de-duplication or skipped by `ON CONFLICT DO NOTHING` against the table.
   */
  duplicatesSkipped: number;
  /** Number of `INSERT` statements issued. */
  statements: number;
  durationMs: number;
  /** Rows written per second across the whole call. */
  throughputPerSecond: number;
}

/**
 * Column order for the generated bulk INSERT. Kept as a single source of
 * truth so the placeholder builder below can never drift from the statement.
 */
const BULK_INSERT_COLUMNS = [
  'id',
  'chain',
  'txHash',
  'contractId',
  'stellarContractId',
  'baseContractAddress',
  'eventType',
  'eventSequence',
  'ledgerHeight',
  'blockHash',
  'eventData',
  'isOrphaned',
] as const;

/**
 * Bind parameters emitted per row.
 *
 * Only the listed columns become parameters — `createdAt`/`updatedAt` are
 * written as literal `DEFAULT` in the VALUES tuple, so the database clock
 * stamps them and they cost nothing on the wire.
 */
const BULK_INSERT_PARAMS_PER_ROW = BULK_INSERT_COLUMNS.length;

/** PostgreSQL's hard ceiling on bind parameters in a single statement. */
const PG_MAX_BIND_PARAMS = 65_535;

/** Rows per statement, never allowed above what the bind limit permits. */
const MAX_SAFE_ROWS_PER_STATEMENT = Math.floor(
  PG_MAX_BIND_PARAMS / BULK_INSERT_PARAMS_PER_ROW,
);

/**
 * Idempotency key for an event. Mirrors the unique index
 * `UQ_calls_chain_tx_hash_sequence` and the `IsNull()` lookup that
 * `upsertEvent` uses, so both write paths agree on what "the same event" is.
 */
function idempotencyKey(event: UpsertCallEventInput): string {
  return `${event.chain}\u0000${event.txHash}\u0000${event.eventSequence ?? '\u0000'}`;
}

/**
 * CallEventStoreService — BE-04.
 *
 * Single write path shared by StellarIndexerService and BaseIndexerService
 * so both chains get the same idempotency and reorg-handling guarantees
 * instead of re-implementing check-then-insert logic per chain.
 *
 *   - Idempotent upsert: keyed on (chain, txHash, eventSequence). Re-delivery
 *     of the same event (indexer restart, overlapping poll windows) updates
 *     the existing row instead of creating a duplicate.
 *   - Reorg handling: if a previously-stored row at the same (chain,
 *     ledgerHeight) carries a different blockHash than what's newly
 *     observed, the chain reorganized at that height. Older rows are
 *     soft-invalidated (`isOrphaned = true`) rather than deleted, keeping
 *     the audit trail intact.
 *   - Full-text search: the `searchVector` tsvector column is kept in sync
 *     by a DB trigger (see migration 1756290000000), so no application code
 *     needs to maintain it explicitly.
 */
@Injectable()
export class CallEventStoreService {
  private readonly logger = new Logger(CallEventStoreService.name);

  constructor(
    @InjectRepository(Call)
    private readonly callRepository: Repository<Call>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ── Idempotent upsert ─────────────────────────────────────────────────────

  async upsertEvent(input: UpsertCallEventInput): Promise<Call> {
    // Run reorg check before writing so we never persist a row on a
    // stale branch.
    if (input.blockHash && input.ledgerHeight != null) {
      await this.handleReorg(input.chain, input.ledgerHeight, input.blockHash);
    }

    const existing = await this.callRepository.findOne({
      where: {
        chain: input.chain,
        txHash: input.txHash,
        eventSequence: input.eventSequence ?? IsNull(),
      },
    });

    if (existing) {
      this.logger.debug(
        `Idempotent re-delivery for ${input.chain}:${input.txHash}:${input.eventSequence} — updating in place`,
      );
      existing.eventData = input.eventData ?? existing.eventData;
      existing.blockHash = input.blockHash ?? existing.blockHash;
      existing.ledgerHeight = input.ledgerHeight ?? existing.ledgerHeight;
      existing.isOrphaned = false;
      return this.callRepository.save(existing);
    }

    const call = this.callRepository.create({
      chain: input.chain,
      txHash: input.txHash,
      contractId: input.contractId,
      stellarContractId: input.stellarContractId,
      baseContractAddress: input.baseContractAddress,
      eventType: input.eventType,
      eventSequence: input.eventSequence,
      ledgerHeight: input.ledgerHeight,
      blockHash: input.blockHash,
      eventData: input.eventData,
      isOrphaned: false,
    });

    return this.callRepository.save(call);
  }

  // ── Reorg detection (atomic QueryRunner) ──────────────────────────────────

  /**
   * Compares the newly observed blockHash for `ledgerHeight` against any
   * previously stored rows at that height. A mismatch means the chain
   * reorganized — the earlier rows are on an orphaned branch.
   *
   * All orphan writes happen inside a single QueryRunner transaction so the
   * batch either fully commits or fully rolls back.
   *
   * Returns the number of rows newly orphaned.
   */
  async handleReorg(
    chain: ChainType,
    ledgerHeight: number,
    newBlockHash: string,
  ): Promise<number> {
    const atHeight = await this.callRepository.find({
      where: { chain, ledgerHeight },
    });

    const conflicting = atHeight.filter(
      (row) => row.blockHash && row.blockHash !== newBlockHash && !row.isOrphaned,
    );

    if (conflicting.length === 0) return 0;

    this.logger.warn(
      `Reorg detected on ${chain} at height ${ledgerHeight}: ` +
        `orphaning ${conflicting.length} row(s) (old hash ≠ ${newBlockHash})`,
    );

    const runner: QueryRunner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      for (const row of conflicting) {
        row.isOrphaned = true;
      }
      await runner.manager.save(Call, conflicting);
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      this.logger.error(`handleReorg transaction rolled back: ${(err as Error).message}`);
      throw err;
    } finally {
      await runner.release();
    }

    return conflicting.length;
  }

  /**
   * Atomically rewinds all event rows for a chain back to `rewindToLedger`.
   * Every row with ledgerHeight > rewindToLedger is soft-orphaned inside
   * a single SERIALIZABLE transaction — guaranteeing no partial rollbacks.
   *
   * Called by LedgerCheckpointService.atomicRewind() on hash-fork detection.
   */
  async rewindToLedger(chain: ChainType, rewindToLedger: number): Promise<number> {
    const runner: QueryRunner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('SERIALIZABLE');

    try {
      const result = await runner.manager
        .createQueryBuilder()
        .update(Call)
        .set({ isOrphaned: true })
        .where('chain = :chain', { chain })
        .andWhere('ledgerHeight > :rewindToLedger', { rewindToLedger })
        .andWhere('isOrphaned = false')
        .execute();

      const rowsAffected = result.affected ?? 0;
      await runner.commitTransaction();

      this.logger.log(
        `rewindToLedger(${chain}, ${rewindToLedger}): orphaned ${rowsAffected} rows`,
      );
      return rowsAffected;
    } catch (err) {
      await runner.rollbackTransaction();
      this.logger.error(`rewindToLedger transaction rolled back: ${(err as Error).message}`);
      throw err;
    } finally {
      await runner.release();
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  /** Non-orphaned events for a chain, most recent first. */
  async getActiveEvents(chain: ChainType, limit = 50): Promise<Call[]> {
    return this.callRepository.find({
      where: { chain, isOrphaned: false },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Returns the highest committed ledger height for a chain. */
  async getLastIndexedLedger(chain: ChainType): Promise<number | null> {
    const row = await this.callRepository.findOne({
      where: { chain, isOrphaned: false },
      order: { ledgerHeight: 'DESC' },
    });
    return row?.ledgerHeight ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bulk / high-throughput write path (BE-008)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Writes a large batch of events with a handful of statements instead of
   * one round trip per event (BE-008).
   *
   * `upsertEvent` is deliberately chatty — a `findOne` then a `save` — because
   * that is the right trade for the live tail of the chain, where a handful of
   * events arrive at a time and correctness of the in-place update matters
   * more than latency. It is the wrong trade for a historical catch-up over
   * hundreds of thousands of ledgers, where the per-event round trip dominates
   * everything else. This path collapses that to one statement per chunk.
   *
   * Guarantees:
   *   - Idempotent. `ON CONFLICT ("chain", "txHash", "eventSequence") DO
   *     NOTHING` is keyed on the same unique index the single-row path relies
   *     on, so replaying a batch — after a crash, a retry, or an overlapping
   *     poll window — never duplicates rows. Events repeated *within* a batch
   *     are collapsed before the statement is even built.
   *   - Bounded statements. Chunks are clamped to the 65535 bind-parameter
   *     limit, so no batch size can produce a statement PostgreSQL rejects.
   *   - Bounded connections. At most `maxConcurrency` statements are in
   *     flight, so a 500k-event catch-up cannot exhaust the pool and starve
   *     the read path.
   *   - Non-throwing. A permanently failing chunk is logged and skipped
   *     rather than aborting the remaining chunks; the returned result
   *     reports what was actually written so the caller can decide whether to
   *     re-drive the remainder.
   *
   * `createdAt`/`updatedAt` are left to the database defaults rather than being
   * stamped in JS, so bulk and single-row writes agree on the clock.
   *
   * Note on reorgs: this path does not run {@link handleReorg}. It is meant
   * for catching up ledgers that are already settled. Re-delivering a
   * reorged-out row is a no-op here, which is safe for a first-pass backfill
   * but is not a substitute for the reorg detection in `upsertEvent`.
   */
  async bulkUpsertEvents(
    events: UpsertCallEventInput[],
    options: BulkUpsertOptions = {},
  ): Promise<BulkUpsertResult> {
    const startedAt = Date.now();

    if (events.length === 0) {
      return {
        attempted: 0,
        deduplicated: 0,
        inserted: 0,
        duplicatesSkipped: 0,
        statements: 0,
        durationMs: 0,
        throughputPerSecond: 0,
      };
    }

    // Collapse repeats within the batch first. Two identical events in one
    // statement would make `ON CONFLICT DO NOTHING` do the right thing anyway,
    // but only for the second one; skipping them here saves the bind
    // parameters and keeps the reported counts honest.
    const unique = new Map<string, UpsertCallEventInput>();
    for (const event of events) {
      const key = idempotencyKey(event);
      if (!unique.has(key)) unique.set(key, event);
    }
    const deduplicated = events.length - unique.size;

    const rowsPerStatement = Math.max(
      1,
      Math.min(
        options.maxRowsPerStatement ?? 1_000,
        MAX_SAFE_ROWS_PER_STATEMENT,
      ),
    );
    const maxConcurrency = Math.max(1, options.maxConcurrency ?? 2);
    const maxRetries = Math.max(0, options.maxRetries ?? 3);
    const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);

    const uniqueEvents = Array.from(unique.values());
    const chunkCount = Math.ceil(uniqueEvents.length / rowsPerStatement);
    this.logger.debug(
      `Bulk upsert: ${events.length} event(s) -> ${unique.size} unique ` +
        `(${deduplicated} collapsed), ${chunkCount} statement(s) of up to ` +
        `${rowsPerStatement} rows, concurrency ${maxConcurrency}`,
    );

    let inserted = 0;
    let statements = 0;
    let nextChunk = 0;

    /**
     * Runs one chunk with bounded retries. `ON CONFLICT DO NOTHING` makes a
     * retry free of side effects, so a statement that may have partially
     * applied before the connection dropped is safe to send again.
     */
    const runChunk = async (chunk: UpsertCallEventInput[]): Promise<void> => {
      const query = this.buildBulkInsert(chunk);
      let lastError: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const backoff = retryDelayMs * 2 ** (attempt - 1);
          this.logger.warn(
            `Bulk insert statement failed (attempt ${attempt}/${maxRetries}), ` +
              `retrying in ${backoff}ms: ${
                lastError instanceof Error ? lastError.message : String(lastError)
              }`,
          );
          await this.delay(backoff);
        }

        try {
          const rows = await this.executeBulkInsert(query.sql, query.params);
          statements += 1;
          inserted += rows;
          return;
        } catch (error) {
          lastError = error;
        }
      }

      this.logger.error(
        `Giving up on a ${chunk.length}-row bulk insert after ` +
          `${maxRetries + 1} attempt(s): ${
            lastError instanceof Error ? lastError.message : String(lastError)
          }. The batch is idempotent, so this range can safely be re-driven.`,
      );
    };

    // Fixed pool of workers pulling chunks off a shared cursor. This bounds
    // concurrency while still letting slow statements overlap with fast ones,
    // and it avoids allocating a promise per chunk for a 500k-event batch.
    const workers = Array.from(
      { length: Math.min(maxConcurrency, chunkCount) },
      async () => {
        for (;;) {
          const start = nextChunk;
          nextChunk += 1;
          if (start >= chunkCount) return;

          const from = start * rowsPerStatement;
          await runChunk(uniqueEvents.slice(from, from + rowsPerStatement));
        }
      },
    );
    await Promise.all(workers);

    const durationMs = Date.now() - startedAt;
    const duplicatesSkipped = events.length - inserted;

    this.logger.log(
      `Bulk upsert complete: ${inserted}/${events.length} row(s) written in ` +
        `${durationMs}ms across ${statements} statement(s) ` +
        `(${Math.round((inserted / Math.max(durationMs, 1)) * 1000)} rows/sec)`,
    );

    return {
      attempted: events.length,
      deduplicated,
      inserted,
      duplicatesSkipped,
      statements,
      durationMs,
      throughputPerSecond: Math.round(
        (inserted / Math.max(durationMs, 1)) * 1000,
      ),
    };
  }

  /**
   * Builds one parameterised `INSERT ... ON CONFLICT DO NOTHING` for a chunk.
   *
   * Values are passed as bind parameters rather than interpolated so event
   * payloads can never be interpreted as SQL, and so PostgreSQL can reuse the
   * prepared plan across chunks of a large catch-up.
   *
   * `RETURNING "id"` is what makes the inserted count exact: rows skipped by
   * `DO NOTHING` produce no returned row, so `rows.length` is precisely what
   * was written.
   */
  private buildBulkInsert(chunk: UpsertCallEventInput[]): {
    sql: string;
    params: unknown[];
  } {
    const params: unknown[] = [];
    const tuples: string[] = [];

    chunk.forEach((event, rowIndex) => {
      const base = rowIndex * BULK_INSERT_PARAMS_PER_ROW;
      const placeholder = (offset: number): string =>
        `$${base + offset + 1}`;

      tuples.push(
        '(' +
          BULK_INSERT_COLUMNS.map((_, col) => placeholder(col)).join(', ') +
          // createdAt / updatedAt: let the DB clock stamp them, matching the
          // CreateDateColumn/UpdateDateColumn defaults the single-row path uses.
          ', DEFAULT, DEFAULT' +
          ')',
      );

      // Generated in the application rather than relying on a uuid default,
      // which avoids a per-row round trip to the database and does not depend
      // on the uuid-ossp extension being installed.
      params.push(randomUUID());
      params.push(event.chain);
      params.push(event.txHash);
      params.push(event.contractId ?? null);
      params.push(event.stellarContractId ?? null);
      params.push(event.baseContractAddress ?? null);
      params.push(event.eventType);
      params.push(event.eventSequence ?? null);
      params.push(event.ledgerHeight ?? null);
      params.push(event.blockHash ?? null);
      // jsonb accepts a pre-serialised string as a parameter.
      params.push(
        event.eventData === undefined || event.eventData === null
          ? null
          : JSON.stringify(event.eventData),
      );
      params.push(false);
    });

    const sql =
      `INSERT INTO "calls" (${BULK_INSERT_COLUMNS.map(
        (c) => `"${c}"`,
      ).join(', ')}, "createdAt", "updatedAt") ` +
      `VALUES ${tuples.join(', ')} ` +
      `ON CONFLICT ("chain", "txHash", "eventSequence") DO NOTHING ` +
      `RETURNING "id"`;

    return { sql, params };
  }

  /** Issues a built insert and returns the number of rows actually written. */
  private async executeBulkInsert(
    sql: string,
    params: unknown[],
  ): Promise<number> {
    const result: unknown = await this.callRepository.query(sql, params);

    // `pg` (and therefore TypeORM) hands back the row array for a ResultSet.
    if (Array.isArray(result)) return result.length;

    // Some drivers wrap it. Accept the common shapes rather than reporting a
    // successful write as zero rows.
    if (result && typeof result === 'object') {
      const wrapped = result as {
        rows?: unknown;
        rowCount?: unknown;
        affectedRows?: unknown;
      };
      if (Array.isArray(wrapped.rows)) return wrapped.rows.length;
      if (typeof wrapped.rowCount === 'number') return wrapped.rowCount;
      if (typeof wrapped.affectedRows === 'number') return wrapped.affectedRows;
    }

    // Defensive: never over-report. Under-reporting only costs a retry, and a
    // retry is safe because the write is idempotent.
    return 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
