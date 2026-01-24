/**
 * Integration helper for OutcomeManager contract interactions
 * Handles signing, verification, and contract calls
 */

import * as libsodium from 'libsodium.js';

export interface OutcomeData {
  callId: bigint;
  outcome: boolean;
  finalPrice: bigint;
  timestamp: bigint;
  oraclePublicKey: Uint8Array;
  signature: Uint8Array;
}

export interface OracleKeypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Generate ed25519 keypair for oracle
 */
export async function generateOracleKeypair(
  seed: Uint8Array
): Promise<OracleKeypair> {
  await libsodium.ready;

  const { publicKey, privateKey } = libsodium.crypto_sign_seed_keypair(seed);

  return { publicKey, privateKey };
}

/**
 * Build the message that needs to be signed for outcome submission
 * Format: [8 bytes: call_id] [1 byte: outcome] [16 bytes: final_price] [8 bytes: timestamp]
 */
export function buildOutcomeMessage(data: OutcomeData): Uint8Array {
  const buffer = new Uint8Array(33); // 8 + 1 + 16 + 8 = 33 bytes

  // Write call_id (u64, big-endian)
  const callIdView = new DataView(buffer.buffer, 0, 8);
  callIdView.setBigInt64(0, BigInt(data.callId), false); // false = big-endian

  // Write outcome (u8)
  buffer[8] = data.outcome ? 1 : 0;

  // Write final_price (u128, big-endian, 16 bytes)
  // Split u128 into two u64 for proper encoding
  const priceUpperView = new DataView(buffer.buffer, 9, 8);
  const priceLowerView = new DataView(buffer.buffer, 17, 8);

  const upper = data.finalPrice >> 64n;
  const lower = data.finalPrice & ((1n << 64n) - 1n);

  priceUpperView.setBigInt64(0, BigInt(upper), false);
  priceLowerView.setBigInt64(0, BigInt(lower), false);

  // Write timestamp (u64, big-endian)
  const timestampView = new DataView(buffer.buffer, 25, 8);
  timestampView.setBigInt64(0, BigInt(data.timestamp), false);

  return buffer;
}

/**
 * Sign an outcome message
 */
export async function signOutcome(
  message: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  await libsodium.ready;

  // Use detached signature (just the signature, no message)
  return libsodium.crypto_sign_detached(message, privateKey);
}

/**
 * Verify an outcome signature (for validation)
 */
export async function verifyOutcomeSignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  await libsodium.ready;

  try {
    return libsodium.crypto_sign_open_detached(message, signature, publicKey);
  } catch (e) {
    return false;
  }
}

/**
 * Oracle signer helper - combines message building and signing
 */
export class OracleSigner {
  private privateKey: Uint8Array;
  private publicKey: Uint8Array;

  constructor(keypair: OracleKeypair) {
    this.privateKey = keypair.privateKey;
    this.publicKey = keypair.publicKey;
  }

  /**
   * Get the public key
   */
  getPublicKey(): Uint8Array {
    return this.publicKey;
  }

  /**
   * Create a complete outcome signature
   */
  async signOutcome(data: OutcomeData): Promise<OutcomeData> {
    const message = buildOutcomeMessage(data);
    const signature = await signOutcome(message, this.privateKey);

    return {
      ...data,
      oraclePublicKey: this.publicKey,
      signature,
    };
  }

  /**
   * Batch sign multiple outcomes
   */
  async signOutcomes(outcomes: OutcomeData[]): Promise<OutcomeData[]> {
    return Promise.all(outcomes.map((outcome) => this.signOutcome(outcome)));
  }
}

/**
 * Calculate payout for a user in a settled call
 */
export function calculatePayout(
  userStake: bigint,
  userSide: boolean,
  outcome: boolean,
  longTokens: bigint,
  shortTokens: bigint
): bigint {
  // Loser gets nothing
  if (userSide !== outcome) {
    return 0n;
  }

  // Winner gets: stake + share of losing side
  const winningTokens = outcome ? longTokens : shortTokens;
  const losingTokens = outcome ? shortTokens : longTokens;

  // Payout = stake + (stake * losing_tokens / winning_tokens)
  return userStake + (userStake * losingTokens) / winningTokens;
}

/**
 * Verify call can be settled (has reached end time)
 */
export function canSettleCall(
  currentTimestamp: bigint,
  endTimestamp: bigint
): boolean {
  return currentTimestamp >= endTimestamp;
}

/**
 * Format oracle address for display
 */
export function formatOracleAddress(address: string): string {
  if (address.length < 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Convert Uint8Array to hex string
 */
export function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return arr;
}

/**
 * Validate signature format
 */
export function isValidSignatureFormat(signature: Uint8Array): boolean {
  // Ed25519 signatures are exactly 64 bytes
  return signature.length === 64;
}

/**
 * Validate public key format
 */
export function isValidPublicKeyFormat(publicKey: Uint8Array): boolean {
  // Ed25519 public keys are exactly 32 bytes
  return publicKey.length === 32;
}

/**
 * Helper to prepare outcome submission data for contract call
 */
export async function prepareOutcomeSubmission(
  callId: bigint,
  outcome: boolean,
  finalPrice: bigint,
  timestamp: bigint,
  oracleSigner: OracleSigner
): Promise<{
  call_id: bigint;
  outcome: boolean;
  final_price: bigint;
  timestamp: bigint;
  oracle_pubkey: Uint8Array;
  signature: Uint8Array;
}> {
  const signed = await oracleSigner.signOutcome({
    callId,
    outcome,
    finalPrice,
    timestamp,
    oraclePublicKey: oracleSigner.getPublicKey(),
    signature: new Uint8Array(64), // Will be replaced by sign method
  });

  return {
    call_id: signed.callId,
    outcome: signed.outcome,
    final_price: signed.finalPrice,
    timestamp: signed.timestamp,
    oracle_pubkey: signed.oraclePublicKey,
    signature: signed.signature,
  };
}

/**
 * Audit trail helper - logs outcome submission for verification
 */
export interface AuditEntry {
  timestamp: bigint;
  callId: bigint;
  outcome: boolean;
  finalPrice: bigint;
  oracleAddress: string;
  signature: string; // hex
}

export class AuditTrail {
  private entries: AuditEntry[] = [];

  addEntry(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  exportJSON(): string {
    return JSON.stringify(this.entries, (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    });
  }

  clear(): void {
    this.entries = [];
  }
}
