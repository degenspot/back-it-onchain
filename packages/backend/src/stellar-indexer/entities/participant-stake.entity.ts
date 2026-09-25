/**
 * participant-stake.entity.ts  (BE-003)
 *
 * Records each participant's stake per outcome slot per call.
 * Designed for idempotent upserts keyed on (chain, callOnchainId, wallet, outcomeIndex).
 *
 * All monetary values stored as DECIMAL strings (no JS Number precision loss).
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('participant_stakes')
@Index('UQ_participant_stakes_key', ['chain', 'callOnchainId', 'wallet', 'outcomeIndex'], {
  unique: true,
})
@Index('IDX_participant_stakes_wallet', ['wallet'])
@Index('IDX_participant_stakes_call', ['callOnchainId', 'chain'])
export class ParticipantStake {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  callOnchainId: string;

  @Column({ default: 'stellar' })
  chain: string;

  /** Wallet/address of the participant (G... for Stellar, 0x... for Base). */
  @Column()
  wallet: string;

  /** Outcome slot index this stake belongs to (0–31). */
  @Column({ type: 'int' })
  outcomeIndex: number;

  /**
   * Cumulative stake amount on this outcome as a decimal string.
   * Updated atomically on each StakeAdded event (additive).
   */
  @Column({ type: 'decimal', precision: 36, scale: 0, default: '0' })
  stakeAmount: string;

  /** Ledger at which the last stake update occurred. */
  @Column({ nullable: true })
  lastLedgerHeight: number;

  /** Transaction hash of the most recent StakeAdded event. */
  @Column({ nullable: true })
  lastTxHash: string;

  @Column({ default: false })
  isOrphaned: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
