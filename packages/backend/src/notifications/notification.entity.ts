import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum NotificationType {
  MARKET_RESOLVED = 'market_resolved',
  STAKE_RECEIVED = 'stake_received',
  NEW_FOLLOWER = 'new_follower',
}

@Entity()
@Index('IDX_notification_recipient', ['recipientWallet'])
@Index('IDX_notification_unread', ['recipientWallet', 'isRead'])
@Index(['recipientWallet', 'isRead', 'createdAt'])
@Index(['recipientWallet', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  recipientWallet: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'recipientWallet', referencedColumnName: 'wallet' })
  recipient: User;

  @Column({
    type: 'enum',
    enum: NotificationType,
  })
  type: NotificationType;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  resourceId: string;

  @Column({ nullable: true })
  resourceType: string;
}