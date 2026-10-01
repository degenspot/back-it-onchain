import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Well-known `action` values written by OracleService. Kept as a plain
 * string union (rather than a Postgres enum) so new actions never require
 * a migration — callers are free to log other actions too.
 */
export enum AuditLogAction {
  ORACLE_SETTLEMENT = 'oracle.settlement',
  ORACLE_UNRESOLVED = 'oracle.unresolved',
  ORACLE_KEY_ROTATED = 'oracle.key_rotated',
  /** BE-12: an ed25519 signature over a canonical Soroban resolution payload. */
  ORACLE_RESOLUTION_SIGNED = 'oracle.resolution_signed',
  /**
   * BE-016: the full resolution evidence bundle for a settled call, sealed to
   * IPFS with a deterministic CIDv1. One row per settled call.
   */
  ORACLE_EVIDENCE_ARCHIVED = 'oracle.evidence_archived',
}

@Entity('audit_logs')
@Index('IDX_audit_log_action_created_at', ['action', 'createdAt'])
@Index('IDX_audit_log_call_action', ['callId', 'action'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Numeric call identifier this log entry relates to (nullable for admin actions). */
  @Column({ nullable: true })
  callId: string;

  /** Action type: e.g. "oracle.sign", "relayer.submit", "admin.pause". */
  @Column()
  action: string;

  /** Wallet address or service identifier that triggered the action. */
  @Column()
  actor: string;

  /** SHA-256 hex hash of the signed / submitted payload for tamper detection. */
  @Column({ nullable: true })
  payloadHash: string;

  /** IPFS CID of supporting evidence attached to this action (optional). */
  @Column({ nullable: true })
  evidenceCid: string;

  // ── BE-016: cryptographic evidence archival ────────────────────────────────

  /**
   * sha256 hex of the exact canonical bytes `evidenceCid` addresses. Recomputing
   * it from `evidence` is how a verifier detects a row that was edited after the
   * fact without also re-deriving the CID (which it cannot, since the CID is the
   * hash of the bytes).
   */
  @Column({ nullable: true })
  evidenceDigest: string;

  /**
   * The canonical evidence document that was sealed, stored byte-for-byte as
   * canonical JSON (sorted keys, no whitespace).
   *
   * Keeping the exact bytes alongside the CID means the public audit endpoint
   * can answer — and prove — what was sealed even when no gateway is reachable.
   * A `jsonb` column would do instead only if Postgres's own key ordering
   * happened to match; storing the canonical text removes that dependency
   * entirely, since the CID is computed over exactly these bytes.
   */
  @Column({ type: 'text', nullable: true })
  evidenceDocument: string;

  /** ed25519 signature over the canonical resolution payload (hex, 64 bytes). */
  @Column({ nullable: true })
  resolutionSignature: string;

  /** ed25519 public key the resolution was signed with (hex, 32 bytes). */
  @Column({ nullable: true })
  resolutionPublicKey: string;

  /** The exact bytes the signature covers (hex) — the Soroban `BytesN<33>` payload. */
  @Column({ nullable: true })
  resolutionMessage: string;

  // ── Legacy fields kept for backward compatibility with indexer.service.ts ──

  @Column({ nullable: true })
  targetResource: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown>;

  /** Chain the action relates to ('base' | 'stellar'), when applicable. */
  @Column({ nullable: true })
  chain: string;

  @CreateDateColumn()
  createdAt: Date;
}
