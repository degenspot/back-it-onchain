/**
 * TypeScript interfaces for OutcomeManager Soroban contract
 * Use these types for off-chain interactions
 */

export interface CallData {
  id: bigint;
  token: string;
  long_tokens: bigint;
  short_tokens: bigint;
  end_ts: bigint;
  settled: boolean;
  outcome: boolean | null;
  final_price: bigint | null;
}

export interface OutcomeSubmittedEvent {
  call_id: bigint;
  outcome: boolean;
  final_price: bigint;
  oracle: string;
}

export interface PayoutWithdrawnEvent {
  call_id: bigint;
  user: string;
  amount: bigint;
}

export interface OracleUpdatedEvent {
  oracle: string;
  authorized: boolean;
}

export type OutcomeManagerEvent =
  | { OutcomeSubmitted: OutcomeSubmittedEvent }
  | { PayoutWithdrawn: PayoutWithdrawnEvent }
  | { OracleUpdated: OracleUpdatedEvent };

export interface SignatureMessage {
  call_id: bigint;
  outcome: boolean;
  final_price: bigint;
  timestamp: bigint;
}

export class OutcomeManagerClient {
  private contractAddress: string;

  constructor(contractAddress: string) {
    this.contractAddress = contractAddress;
  }

  /**
   * Build the message bytes for oracle signature
   * Format: [8 bytes: call_id] [1 byte: outcome] [16 bytes: final_price] [8 bytes: timestamp]
   */
  buildSignatureMessage(message: SignatureMessage): Buffer {
    const buffer = Buffer.alloc(33); // 8 + 1 + 16 + 8 = 33 bytes

    // Write call_id (u64, big-endian)
    buffer.writeBigUInt64BE(message.call_id, 0);

    // Write outcome (u8)
    buffer.writeUInt8(message.outcome ? 1 : 0, 8);

    // Write final_price (u128, big-endian, 16 bytes)
    // Split u128 into two u64 for JS compatibility
    const priceBigInt = message.final_price;
    const upper = priceBigInt >> 64n;
    const lower = priceBigInt & ((1n << 64n) - 1n);

    buffer.writeBigUInt64BE(upper, 9);
    buffer.writeBigUInt64BE(lower, 17);

    // Write timestamp (u64, big-endian)
    buffer.writeBigUInt64BE(message.timestamp, 25);

    return buffer;
  }

  /**
   * Get the contract address
   */
  getContractAddress(): string {
    return this.contractAddress;
  }
}

/**
 * Helper to calculate payout for a user
 */
export function calculatePayout(
  userStake: bigint,
  userSide: boolean,
  outcome: boolean,
  longTokens: bigint,
  shortTokens: bigint
): bigint {
  if (userSide !== outcome) {
    // User lost
    return 0n;
  }

  // User won
  const winningTokens = outcome ? longTokens : shortTokens;
  const losingTokens = outcome ? shortTokens : longTokens;

  // Payout = stake + (stake * losing_tokens / winning_tokens)
  return userStake + (userStake * losingTokens) / winningTokens;
}

/**
 * Helper to verify if a call can be settled
 */
export function canSettleCall(currentTimestamp: bigint, call_end_ts: bigint): boolean {
  return currentTimestamp >= call_end_ts;
}
