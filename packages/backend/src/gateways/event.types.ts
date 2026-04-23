/**
 * Strongly-typed payloads for every EventEmitter2 event the gateway listens to.
 * These mirror the events emitted by the service layer (Issue 9 hooks).
 */

export interface StakeCreatedEvent {
  marketId: string;
  staker: string;
  amount: string;       // stringified bigint / token amount
  outcomeIndex: number;
  timestamp: number;
  txHash?: string;
}

export interface PriceUpdatedEvent {
  marketId: string;
  price: string;        // stringified decimal
  source: string;       // e.g. "chainlink" | "pyth" | "manual"
  timestamp: number;
}

export interface OutcomeProposedEvent {
  marketId: string;
  callId: string;
  submitter: string;
  resultCode: number;
  windowExpiresAt: number;
  timestamp: number;
}

export interface DisputeRaisedEvent {
  marketId: string;
  callId: string;
  staker: string;       // userId / wallet address of the disputer
  bondAmount: string;
  disputedAt: number;
  txHash?: string;
}

export interface DisputeResolvedEvent {
  marketId: string;
  callId: string;
  staker: string;
  resolution: 'upheld' | 'rejected';
  finalOutcomeCode: number;
  resolvedAt: number;
  txHash?: string;
}

export interface UserNotificationEvent {
  userId: string;
  type: string;         // e.g. "stake.confirmed" | "reward.claimable"
  payload: Record<string, unknown>;
  timestamp?: number;
}
