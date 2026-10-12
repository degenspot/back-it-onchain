import { Socket } from 'socket.io';

/**
 * Strongly-typed payloads for every EventEmitter2 event the gateway listens to.
 * These mirror the events emitted by the service layer (Issue 9 hooks).
 */

export interface AuthenticatedSocket extends Socket {
  data: {
    userId: string | null;
    /** When this connection authenticated, for connection-age diagnostics. */
    authenticatedAt?: number;
  };
}

export interface StakeCreatedEvent {
  marketId: string;
  staker: string;
  amount: string; // stringified bigint / token amount
  outcomeIndex: number;
  timestamp: number;
  txHash?: string;
}

export interface PriceUpdatedEvent {
  marketId: string;
  price: string; // stringified decimal
  source: string; // e.g. "chainlink" | "pyth" | "manual"
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
  staker: string; // userId / wallet address of the disputer
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

// ── Disputes (BE-019) ─────────────────────────────────────────────────────

export interface DisputeEscalatedEvent {
  disputeId: string;
  callId: string;
  /** On-chain market id, which may differ from the internal call id. */
  marketId?: string;
  totalBond: string;
  quorum: number;
  voteDeadlineAt: string;
}

export interface DisputeDecisionEvent {
  disputeId: string;
  callId: string;
  totalBond: string;
  reason: string;
}

export interface UserNotificationEvent {
  userId: string;
  type: string; // e.g. "stake.confirmed" | "reward.claimable"
  payload: Record<string, unknown>;
  timestamp?: number;
}
