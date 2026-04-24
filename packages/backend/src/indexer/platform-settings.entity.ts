import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('platform_settings')
export class PlatformSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'float', default: 0 })
  feePercent: number;

  @Column({ type: 'boolean', default: false })
  isPaused: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
