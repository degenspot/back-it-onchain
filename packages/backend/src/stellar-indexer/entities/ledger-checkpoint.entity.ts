/**
 * ledger-checkpoint.entity.ts  (BE-002)
 *
 * Durable store for per-stream ledger checkpoints.
 * Each row tracks:
 *   - The last fully-committed ledger sequence for a stream key.
 *   - The ledger hash at that sequence (used for reorg detection).
 *   - Whether this checkpoint is the canonical (non-orphaned) one.
 *
 * A unique index on `streamKey` means one active checkpoint per stream.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('ledger_checkpoints')
@Index('UQ_ledger_checkpoints_stream_key', ['streamKey'], { unique: true })
export class LedgerCheckpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Stable identifier for the indexer stream.
   * Typically: `stellar:<sorted_contract_ids>` or `base:<contract_address>`.
   */
  @Column({ unique: true })
  streamKey: string;

  /** Last fully-processed ledger sequence number. */
  @Column({ type: 'bigint' })
  ledgerSequence: string; // stored as string to avoid JS int overflow on large ledger numbers

  /**
   * Hash fingerprint of the ledger at `ledgerSequence`.
   * For Soroban: `ledgerClosedAt` timestamp is used as the fingerprint
   * (the RPC does not expose raw ledger header hashes). For Base: the
   * block hash from ethers.
   *
   * If a future poll sees a different hash at the same sequence, a reorg
   * has occurred and a rewind must be triggered back to sequence - 1.
   */
  @Column({ nullable: true })
  ledgerHash: string;

  /** Chain identifier — `stellar` or `base`. */
  @Column({ default: 'stellar' })
  chain: string;

  /** True when this checkpoint is the live canonical one. */
  @Column({ default: true })
  isCanonical: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
