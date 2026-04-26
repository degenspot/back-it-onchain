import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity()
@Index(['callOnchainId', 'createdAt'])
@Index('IDX_stake_activity_staker', ['stakerWallet'])
export class StakeActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  callOnchainId: string;

  @Column()
  stakerWallet: string;

  @Column('decimal', { precision: 36, scale: 18, default: 0 })
  amount: number;

  @CreateDateColumn()
  createdAt: Date;
}