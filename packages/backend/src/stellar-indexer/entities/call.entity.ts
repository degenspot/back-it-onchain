import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ChainType {
  BASE = 'base',
  STELLAR = 'stellar',
}

@Entity('calls')
@Index('idx_calls_chain_tx_hash', ['chain', 'txHash'])
@Index('idx_calls_contract_id', ['contractId'])
@Index('idx_calls_created_at', ['createdAt'])
export class Call {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ChainType,
    default: ChainType.BASE,
  })
  chain: ChainType;

  @Column({
    nullable: false,
    comment: 'Transaction hash from the respective chain',
  })
  txHash: string;

  @Column({
    nullable: true,
    comment: 'Contract ID for Stellar, contract address for Base',
  })
  contractId: string;

  @Column({
    nullable: true,
    comment: 'Stellar-specific: XDR encoded contract ID',
  })
  stellarContractId: string;

  @Column({
    nullable: true,
    comment: 'Base chain: contract address',
  })
  baseContractAddress: string;

  @Column('jsonb', {
    nullable: true,
    comment: 'Event data parsed from contract event',
  })
  eventData: Record<string, any>;

  @Column({
    nullable: true,
    comment: 'Ledger/block number where event occurred',
  })
  ledgerHeight: number;

  @Column({
    nullable: true,
    comment: 'Event type: CallCreated, StakeAdded, OutcomeSubmitted',
  })
  eventType: string;

  @Column({
    nullable: true,
    comment: 'Soroban or Base event sequence',
  })
  eventSequence: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
