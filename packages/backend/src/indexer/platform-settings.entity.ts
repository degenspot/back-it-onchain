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

  /**
   * Cursor for Base Data API polling (BE-05).
   * Persists the last fully-processed block number so polling can resume
   * after a restart without missing or re-scanning windows.
   * Stored as bigint string to avoid JS number overflow; treated as number
   * in application code (safe for block heights).
   */
  @Column({ type: 'bigint', nullable: true, default: 0 })
  lastBlock: string;

  /**
   * Optional block hash at lastBlock for reorg detection.
   * When set, a mismatch between the stored hash and the chain's current
   * hash at that height indicates a reorg.
   */
  @Column({ type: 'varchar', nullable: true })
  lastBlockHash: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
