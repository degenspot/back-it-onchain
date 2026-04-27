import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity()
@Index('IDX_call_status', ['status'])
@Index('IDX_call_end_ts', ['endTs'])
@Index('IDX_call_creator_wallet', ['creatorWallet'])
export class Call {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'bigint', nullable: true })
  callOnchainId: string;

  @Column()
  creatorWallet: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'creatorWallet' })
  creator: User;

  @Column()
  ipfsCid: string;

  @Column()
  tokenAddress: string;

  @Column({ nullable: true })
  pairId: string;

  @Column()
  stakeToken: string;

  @Column('decimal', { default: 0 })
  totalStakeYes: number;

  @Column('decimal', { default: 0 })
  totalStakeNo: number;

  @Column('timestamptz')
  startTs: Date;

  @Column('timestamptz')
  endTs: Date;

  @Column('jsonb', { nullable: true })
  conditionJson: any;

  @Column({ default: 'OPEN' })
  status: string;

  @Column({ nullable: true })
  outcome: boolean;

  @Column('decimal', { nullable: true })
  finalPrice: number;

  @Column({ nullable: true })
  oracleSignature: string;

  @Column({ nullable: true })
  evidenceCid: string;

  @Column({ default: 'base' })
  chain: 'base' | 'stellar';

  @Column({ default: false })
  isHidden: boolean;

  @Column({ default: 0 })
  reportCount: number;

  /** Wallet address of the most recent reporter (for abuse tracking). */
  @Column({ nullable: true })
  lastReporterWallet: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
