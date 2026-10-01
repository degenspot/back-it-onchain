import * as nacl from 'tweetnacl';

/**
 * Dependency-light ed25519 verification (BE-016).
 *
 * The public audit endpoint has to answer "is this signature really the
 * oracle's?" for records that may have been written by a previous process —
 * possibly with an HSM-backed key rather than the local one this process holds.
 * Verifying therefore takes the public key from the archived record itself and
 * uses only ed25519, so the check works regardless of which signer produced the
 * signature. It lives outside `key-signer.ts` so the audit trail does not pull
 * in the EVM/KMS signing stack just to verify 64 bytes.
 */

/** Length of a raw ed25519 signature (`BytesN<64>` on-chain). */
export const ED25519_SIGNATURE_BYTES = 64;
/** Length of a raw ed25519 public key (`BytesN<32>` on-chain). */
export const ED25519_PUBLIC_KEY_BYTES = 32;

const HEX = /^[0-9a-fA-F]+$/;

/**
 * Parses a hex string into exactly `expectedBytes` bytes.
 * Returns `null` (rather than throwing) for anything malformed, so callers can
 * treat "unverifiable" as a verification failure instead of an error path.
 */
export function parseHexBytes(value: unknown, expectedBytes: number): Uint8Array | null {
  if (typeof value !== 'string') return null;
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (hex.length !== expectedBytes * 2 || !HEX.test(hex)) return null;
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/**
 * Verifies an ed25519 signature over `message`.
 *
 * @param message     the exact bytes that were signed
 * @param signatureHex 128 hex chars (`BytesN<64>`)
 * @param publicKeyHex 64 hex chars (`BytesN<32>`)
 * @returns false — never throws — when the signature, the key or the message
 *   itself is malformed, so a corrupt audit row cannot take down the endpoint.
 */
export function verifyEd25519Signature(
  message: Uint8Array,
  signatureHex: unknown,
  publicKeyHex: unknown,
): boolean {
  const signature = parseHexBytes(signatureHex, ED25519_SIGNATURE_BYTES);
  const publicKey = parseHexBytes(publicKeyHex, ED25519_PUBLIC_KEY_BYTES);
  if (!signature || !publicKey) return false;
  if (!(message instanceof Uint8Array) || message.length === 0) return false;

  try {
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}
