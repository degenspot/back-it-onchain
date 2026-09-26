/**
 * outcome-pool.entity.ts  (BE-003)
 *
 * Tracks stake distribution per outcome slot for a multi-outcome call.
 * Supports up to 32 outcome slots per call (Soroban contract max).
 *
 * All monetary amounts are stored as DECIMAL(36,0) strings to maintain
 * full BigInt precision — Soroban I128/U128 values can exceed JS Number
 * safe range (2^53).
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('outcome_pools')
@Index('IDX_outcome_pools_call_ledger', ['callOnchainId', 'ledgerHeight'])
@Index('IDX_outcome_pools_chain_call', ['chain', 'callOnchainId'])
export class OutcomePool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** On-chain call identifier (from CallCreated event). */
  @Column()
  callOnchainId: string;

  /** Chain this pool belongs to. */
  @Column({ default: 'stellar' })
  chain: string;

  /**
   * Outcome slot index (0-based, max 31).
   * Each row represents one outcome bucket of a multi-outcome call.
   */
  @Column({ type: 'int' })
  outcomeIndex: number;

  /**
   * Human-readable outcome label decoded from Soroban SCVal Symbol/String.
   * Example: "yes", "no", "draw", "outcome_a"
   */
  @Column({ nullable: true })
  outcomeLabel: string;

  /**
   * Total stake in this outcome bucket as a decimal string.
   * Uses string to avoid JS Number precision loss on I128 values.
   */
  @Column({ type: 'decimal', precision: 36, scale: 0, default: '0' })
  totalStake: string;

  /**
   * Number of unique participants who staked on this outcome.
   */
  @Column({ type: 'int', default: 0 })
  participantCount: number;

  /**
   * Ledger at which this pool snapshot was last updated.
   */
  @Column({ nullable: true })
  ledgerHeight: number;

  /** Block/ledger hash at last update — for reorg invalidation. */
  @Column({ nullable: true })
  blockHash: string;

  @Column({ default: false })
  isOrphaned: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
