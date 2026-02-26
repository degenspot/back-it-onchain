import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('platform_settings')
export class PlatformSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'float', default: 0 })
  feePercent: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
