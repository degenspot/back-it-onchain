import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity()
export class Call {
  @PrimaryGeneratedColumn()
  id: number;

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

  @Column('jsonb')
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
