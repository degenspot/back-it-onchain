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
}
