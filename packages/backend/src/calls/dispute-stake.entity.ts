import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Dispute } from './dispute.entity';

export type StakeStatus = 'ACTIVE' | 'RETURNED' | 'SLASHED';

/**
 * One staker's bond on a dispute (BE-019).
 *
 * A separate table rather than a column on the dispute, because the threshold
 * is an *aggregate*: governance only gets involved once enough total value is
 * at risk. It also makes the bond individually slashable — an overturned
 * dispute takes the stakers' money, and that has to be recorded per wallet to
 * be payable.
 */
@Entity('dispute_stakes')
@Index('IDX_dispute_stake_dispute', ['disputeId'])
@Index('IDX_dispute_stake_wallet', ['stakerWallet'])
@Index('IDX_dispute_stake_unique', ['disputeId', 'stakerWallet'], {
  unique: true,
})
export class DisputeStake {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  disputeId: string;

  @ManyToOne(() => Dispute, (dispute) => dispute.stakes)
  @JoinColumn({ name: 'disputeId' })
  dispute: Dispute;

  @Column()
  stakerWallet: string;

  /** Exact decimal string; see the note on `Dispute.bondAmount`. */
  @Column('decimal', { precision: 36, scale: 18 })
  amount: string;

  @Column({ default: 'ACTIVE' })
  status: StakeStatus;

  @Column({ type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
