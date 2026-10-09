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

export type EvidenceKind = 'CLAIM' | 'COUNTER';

/**
 * Off-chain evidence attached to a dispute (BE-019).
 *
 * Only the CID lives in the database. The content itself stays on IPFS: a
 * dispute filing is prose and screenshots, which have no business in a
 * Postgres row, and keeping them off-chain means adding a dispute does not
 * grow the database.
 *
 * Counter-evidence is a list rather than a single column because a rebuttal
 * usually has to answer several specific claims, and forcing a second rebuttal
 * to overwrite the first would lose the exchange.
 */
@Entity('dispute_evidence')
@Index('IDX_dispute_evidence_dispute', ['disputeId'])
export class DisputeEvidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  disputeId: string;

  @ManyToOne(() => Dispute, (dispute) => dispute.evidence)
  @JoinColumn({ name: 'disputeId' })
  dispute: Dispute;

  @Column()
  submitterWallet: string;

  @Column({ default: 'CLAIM' })
  kind: EvidenceKind;

  @Column({ type: 'text' })
  cid: string;

  /** Short human-readable note describing what the CID contains. */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
