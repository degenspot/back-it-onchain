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

export type GovernanceDecision = 'OVERTURN' | 'CONFIRM';

/**
 * One governance signer's vote on an escalated dispute (BE-019).
 *
 * A multisig is a set of individual signatures, not a single admin flag, so
 * each approval is its own row. That is what makes the quorum check meaningful
 * and what leaves an audit trail of who voted which way.
 *
 * The unique index on (disputeId, signerWallet) is the real guard: a signer
 * cannot change their vote by submitting twice, which would otherwise let one
 * wallet vote both ways and manufacture quorum on its own.
 */
@Entity('dispute_approvals')
@Index('IDX_dispute_approval_dispute', ['disputeId'])
@Index('IDX_dispute_approval_unique', ['disputeId', 'signerWallet'], {
  unique: true,
})
export class DisputeApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  disputeId: string;

  @ManyToOne(() => Dispute, (dispute) => dispute.approvals)
  @JoinColumn({ name: 'disputeId' })
  dispute: Dispute;

  @Column()
  signerWallet: string;

  @Column()
  decision: GovernanceDecision;

  /** Optional note explaining the vote. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
