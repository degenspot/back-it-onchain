import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Call } from './call.entity';
import { DisputeStake } from './dispute-stake.entity';
import { DisputeEvidence } from './dispute-evidence.entity';
import { DisputeApproval } from './dispute-approval.entity';

/**
 * Dispute lifecycle (BE-019).
 *
 *   OPEN ──stake threshold met──▶ VOTING ──quorum OVERTURN──▶ OVERTURNED
 *     │                            │
 *     │                            └──quorum CONFIRM / vote timeout──▶ CONFIRMED
 *     └──window expires (threshold not met)─────────────────────────▶ CONFIRMED
 *
 * Every path that is not an explicit OVERTURN lands on CONFIRMED. That is
 * deliberate: the safe failure mode for a dispute system is to uphold the
 * original resolution. Anything ambiguous — a window that closed, a vote that
 * never reached quorum, a governance signer who never showed up — resolves in
 * favour of the outcome the oracle already signed, and the staker gets their
 * bond back.
 *
 * Note the bond is a *string*, not a number. A JS number cannot represent
 * 18-decimal fixed-point values, and a bond that rounds is a bond that pays
 * out the wrong amount.
 */
export type DisputeStatus = 'OPEN' | 'VOTING' | 'OVERTURNED' | 'CONFIRMED';

/** Why a dispute ended the way it did. */
export type DisputeOutcomeReason =
  | 'STAKE_THRESHOLD_MET'
  | 'WINDOW_EXPIRED'
  | 'GOVERNANCE_QUORUM'
  | 'VOTE_TIMEOUT'
  | 'ADMIN_DECISION';

@Entity('disputes')
@Index('IDX_dispute_call_id', ['callId'])
@Index('IDX_dispute_raiser', ['raiserWallet'])
@Index('IDX_dispute_status', ['status'])
@Index('IDX_dispute_window', ['windowExpiresAt'])
// Partial unique index: only *active* disputes are unique per call. Terminal
// ones are history, and a call may have several over its lifetime, so
// uniqueness has to stop at the terminal states.
//
// This is the backstop for the "one active dispute per call" anti-spam rule.
// The service checks too, but a check is only as strong as the gap between its
// read and its write: two simultaneous raises can both observe "no active
// dispute" and both insert. Without this index that race files the same dispute
// twice, and a threshold measured per dispute stops meaning anything.
@Index('uq_disputes_active_per_call', ['callId'], {
  unique: true,
  where: `"status" IN ('OPEN', 'VOTING')`,
})
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  callId: number;

  @ManyToOne(() => Call)
  @JoinColumn({ name: 'callId' })
  call: Call;

  /** Wallet address of the party raising the dispute. */
  @Column()
  raiserWallet: string;

  /**
   * Bond staked by the first raiser. Later stakers are recorded in
   * `dispute_stakes`; this column is kept as the opening bond so the original
   * stake is still attributable after the aggregate moves.
   */
  @Column('decimal', { precision: 36, scale: 18, default: 0 })
  bondAmount: string;

  /** Sum of every active stake on this dispute, as an exact decimal string. */
  @Column('decimal', { precision: 36, scale: 18, default: 0 })
  totalBond: string;

  @Column({ default: 'OPEN' })
  status: DisputeStatus;

  /**
   * The disputer's claim, in prose. The full argument is expected to be pinned
   * off-chain with the CID in `claimCid`; this field exists so a claim is still
   * meaningful if the pin is garbage-collected.
   */
  @Column({ type: 'text' })
  claim: string;

  /** IPFS CID of the full claim document. */
  @Column({ type: 'text', nullable: true })
  claimCid: string | null;

  /**
   * When this dispute can no longer accept new stakes or evidence: the call's
   * settlement time plus the dispute window (24 h by default).
   */
  @Column({ type: 'timestamptz' })
  windowExpiresAt: Date;

  /** Set when the stake threshold is met and governance is asked to decide. */
  @Column({ type: 'timestamptz', nullable: true })
  votingStartedAt: Date | null;

  /** Deadline for the governance multisig to reach a decision. */
  @Column({ type: 'timestamptz', nullable: true })
  voteDeadlineAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  /**
   * Snapshot of the governance quorum requirement at escalation time.
   * Stored rather than read live so a config change cannot retroactively
   * invalidate a vote that is already under way.
   */
  @Column({ type: 'int', nullable: true })
  governanceQuorum: number | null;

  @Column({ nullable: true })
  resolvedBy: string | null;

  /** True = dispute upheld and the resolution overturned. */
  @Column({ nullable: true })
  upheld: boolean | null;

  @Column({ type: 'text', nullable: true })
  resolutionNote: string | null;

  @OneToMany(() => DisputeStake, (stake) => stake.dispute)
  stakes: DisputeStake[];

  @OneToMany(() => DisputeEvidence, (evidence) => evidence.dispute)
  evidence: DisputeEvidence[];

  @OneToMany(() => DisputeApproval, (approval) => approval.dispute)
  approvals: DisputeApproval[];

  @CreateDateColumn()
  raisedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Terminal states accept no further transitions. */
  get isTerminal(): boolean {
    return this.status === 'OVERTURNED' || this.status === 'CONFIRMED';
  }
}
