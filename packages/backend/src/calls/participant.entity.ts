import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Call } from './call.entity';

@Entity('participants')
@Index('IDX_participant_call_wallet', ['callId', 'wallet'])
export class Participant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  callId: string;

  @ManyToOne(() => Call)
  @JoinColumn({ name: 'callId' })
  call: Call;

  @Column()
  wallet: string;

  @Column('decimal', { precision: 36, scale: 18, default: 0 })
  amount: number;

  @Column({ default: true })
  position: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
