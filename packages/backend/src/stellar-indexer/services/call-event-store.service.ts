import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
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
   * Block/ledger hash for the height this event was observed at. When
   * supplied together with `ledgerHeight`, this is the cursor used to
   * detect chain reorgs — see handleReorg().
   */
  blockHash?: string;
  eventData?: Record<string, unknown>;
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
  ) {}

  async upsertEvent(input: UpsertCallEventInput): Promise<Call> {
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

  /**
   * Compares the newly observed blockHash for `ledgerHeight` against any
   * previously stored rows at that same height. A mismatch means the chain
   * reorganized and the earlier rows sit on an orphaned branch — they are
   * flagged `isOrphaned = true` (soft-invalidated, never deleted) so
   * downstream consumers can filter them out while the audit trail is kept.
   *
   * Returns the number of rows newly orphaned by this check.
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
      (row) =>
        row.blockHash && row.blockHash !== newBlockHash && !row.isOrphaned,
    );

    if (conflicting.length === 0) return 0;

    this.logger.warn(
      `Reorg detected on ${chain} at height ${ledgerHeight}: orphaning ` +
        `${conflicting.length} row(s) whose blockHash no longer matches ${newBlockHash}`,
    );

    for (const row of conflicting) {
      row.isOrphaned = true;
    }
    await this.callRepository.save(conflicting);
    return conflicting.length;
  }

  /** Non-orphaned events for a chain, most recent first — convenience for the orchestrator/controller. */
  async getActiveEvents(chain: ChainType, limit = 50): Promise<Call[]> {
    return this.callRepository.find({
      where: { chain, isOrphaned: false },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
