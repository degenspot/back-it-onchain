import { createHash } from 'node:crypto';

/**
 * Content addressing for the oracle audit trail (BE-016).
 *
 * The audit document for a settled call is pinned to IPFS, and the CID is the
 * proof that what a verifier fetches later is byte-identical to what the oracle
 * sealed at settlement time. Relying on the *provider's* CID for that proof
 * does not work: Pinata, Kubo and remote pinning services each pick their own
 * codec and CID version, so the same document can come back as `Qm…` (CIDv0,
 * dag-pb) from one and `bafk…` (CIDv1, raw) from another — and the CID stored
 * in the database would then describe bytes nobody else can reproduce.
 *
 * So the CID is computed here, deterministically, from the canonical bytes:
 *
 *   CIDv1 = multibase(base32, 0x01 ‖ codec ‖ multihash)
 *   multihash = 0x12 (sha2-256) ‖ 0x20 (32-byte digest) ‖ sha256(bytes)
 *
 * The provider is still asked to pin the same bytes; its answer is recorded
 * alongside, but the CID in the audit record is the one derived locally.
 */

/** Multicodec for a single, unframed binary block (`raw`). */
export const RAW_CODEC = 0x55;
/** Multicodec for a dag-json block (used when a document must stay traversable). */
export const DAG_JSON_CODEC = 0x0129;
/** Multihash code for sha2-256. */
export const SHA2_256_CODE = 0x12;
/** Digest length of sha2-256, in bytes. */
export const SHA2_256_LENGTH = 32;
/** Multibase prefix for RFC 4648 base32, lower case, no padding. */
export const BASE32_PREFIX = 'b';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Raised when a document contains something JSON cannot represent exactly. */
export class NonCanonicalDocumentError extends Error {
  constructor(message: string) {
    super(`Cannot canonicalize document — ${message}`);
    this.name = 'NonCanonicalDocumentError';
  }
}

/**
 * Encodes an unsigned integer as a protobuf-style varint (LEB128, unsigned).
 */
function toVarint(value: number): number[] {
  if (!Number.isInteger(value) || value < 0) {
    throw new NonCanonicalDocumentError(`varint value must be a u32, got ${value}`);
  }
  const out: number[] = [];
  let remaining = value;
  do {
    const byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    out.push(remaining > 0 ? byte | 0x80 : byte);
  } while (remaining > 0);
  return out;
}

/** RFC 4648 base32, lower case, unpadded — the `b` multibase encoding. */
export function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Deterministically serialises a JSON document: object keys are sorted
 * recursively, arrays keep their order, and no whitespace is emitted.
 *
 * Two documents that differ only in key insertion order therefore hash to the
 * same CID — without this, a re-archived record would look tampered with.
 *
 * @throws NonCanonicalDocumentError on values JSON would silently mangle
 *   (`NaN`, `±Infinity`, `BigInt`, functions, symbols, cycles).
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value, new Set()));
}

function canonicalizeValue(value: unknown, seen: Set<object>): unknown {
  if (value === null) return null;

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;

  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new NonCanonicalDocumentError(
        `non-finite number ${String(value)} has no stable JSON encoding`,
      );
    }
    return value;
  }

  if (type === 'bigint') {
    throw new NonCanonicalDocumentError(
      'BigInt has no unambiguous JSON encoding; convert it to a decimal string first',
    );
  }

  if (type === 'undefined') {
    // `undefined` members are dropped rather than throwing: callers build the
    // document from optional evidence (candles, TWAP summary) and an omitted
    // field must not change the archive's shape.
    return undefined;
  }

  if (type === 'function' || type === 'symbol') {
    throw new NonCanonicalDocumentError(`${type} has no JSON encoding`);
  }

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new NonCanonicalDocumentError('circular reference');
    }
    seen.add(value);
    const mapped = value.map((item) => canonicalizeValue(item, seen) ?? null);
    seen.delete(value);
    return mapped;
  }

  if (type === 'object') {
    if (seen.has(value as object)) {
      throw new NonCanonicalDocumentError('circular reference');
    }
    seen.add(value as object);
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = canonicalizeValue(source[key], seen);
      if (child !== undefined) out[key] = child;
    }
    seen.delete(value as object);
    return out;
  }

  throw new NonCanonicalDocumentError(`unsupported value of type ${type}`);
}

/** sha2-256 of `bytes`, hex encoded. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * CIDv1 for `bytes`, multibase-base32 encoded. The same bytes always produce
 * the same CID, on any machine, with no provider involvement.
 */
export function computeCidV1(bytes: Uint8Array, codec: number = RAW_CODEC): string {
  const digest = createHash('sha256').update(bytes).digest();
  const cidBytes = Uint8Array.from([
    0x01, // CID version 1
    ...toVarint(codec),
    ...toVarint(SHA2_256_CODE),
    ...toVarint(digest.length),
    ...digest,
  ]);
  return BASE32_PREFIX + toBase32(cidBytes);
}

/** CIDv1 for the canonical form of a JSON document. */
export function computeDocumentCid(
  document: unknown,
  codec: number = RAW_CODEC,
): { cid: string; canonical: string; digest: string; size: number } {
  const canonical = canonicalizeJson(document);
  const bytes = Buffer.from(canonical, 'utf8');
  return {
    cid: computeCidV1(bytes, codec),
    canonical,
    digest: sha256Hex(bytes),
    size: bytes.length,
  };
}

/**
 * Re-derives the CID from `bytes` and compares it with `cid` — the check a
 * verifier runs against a document fetched from a gateway. A malformed CID is
 * "not verifiable", not an exception, so a bad gateway response cannot crash
 * the audit endpoint.
 */
export function verifyCidV1(cid: string, bytes: Uint8Array, codec: number = RAW_CODEC): boolean {
  if (typeof cid !== 'string' || !cid.startsWith(BASE32_PREFIX)) return false;
  let expected: string;
  try {
    expected = computeCidV1(bytes, codec);
  } catch {
    return false;
  }
  if (cid.length !== expected.length) return false;
  // Constant-time-ish comparison is unnecessary (both sides are public), but a
  // length check first keeps a truncated CID from being compared at all.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= cid.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
