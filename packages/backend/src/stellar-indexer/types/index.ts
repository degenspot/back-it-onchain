/**
 * Soroban Event Types
 */
export enum SorobanEventType {
  CALL_CREATED = 'CallCreated',
  STAKE_ADDED = 'StakeAdded',
  OUTCOME_SUBMITTED = 'OutcomeSubmitted',
}

/**
 * Supported blockchain chains
 */
export enum BlockchainChain {
  STELLAR = 'stellar',
  BASE = 'base',
}

/**
 * Parsed Soroban event structure
 */
export interface ParsedEvent {
  id: string;
  chain: BlockchainChain;
  txHash: string;
  contractId: string;
  ledgerHeight: number;
  eventType: SorobanEventType | string;
  eventData: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Event statistics
 */
export interface EventStatistics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  lastIndexedLedger?: number;
  lastIndexedBlock?: number;
}

/**
 * Indexer status
 */
export interface IndexerStatus {
  isRunning: boolean;
  stellarEnabled: boolean;
  baseEnabled: boolean;
  currentLedger?: number;
  currentBlock?: number;
}

/**
 * Raw Soroban RPC response
 */
export interface SorobanEventResponse {
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  id: string;
  pagingToken: string;
  txHash: string;
  txId: number;
  contract?: {
    topics?: string[];
    data?: string;
  };
}

/**
 * Indexed event in database
 */
export interface IndexedEvent {
  id: string;
  chain: BlockchainChain;
  txHash: string;
  contractId: string;
  ledgerHeight: number;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
