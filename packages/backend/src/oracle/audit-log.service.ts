import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog, AuditLogAction } from './audit-log.entity';
import { IpfsService } from '../ipfs/ipfs.service';
import {
  RAW_CODEC,
  canonicalizeJson,
  computeCidV1,
  sha256Hex,
  verifyCidV1,
} from '../common/ipfs/cid.util';
import { verifyEd25519Signature } from '../common/crypto/ed25519.util';

export interface AppendAuditParams {
  callId?: string;
  action: string;
  actor: string;
  payloadHash?: string;
  evidenceCid?: string;
}

/** Schema version of the sealed evidence document. */
export const EVIDENCE_SCHEMA_VERSION = 1 as const;

/** The action label recorded inside every sealed evidence document. */
export const EVIDENCE_DOCUMENT_ACTION = 'oracle.resolution_signed' as const;

/** One candle, mirroring `TwapCalculatorService.Candle`. */
export type EvidenceCandle = {
  /** Candle open time, unix seconds. */
  timestamp: number;
  /** Typical/trade price for the interval, in USD. */
  close: number;
  /** Volume for the interval, when the provider returned one. */
  volume?: number;
};

/**
 * The raw price-provider response, verbatim.
 *
 * The issue asks for the raw API response JSON specifically because the parsed
 * `price` alone cannot be re-derived by a third party: if the provider changes
 * its aggregation, the only way to reproduce a settlement is to re-run the same
 * parsing over the same bytes.
 */
export type RawPriceEvidence = {
  source: 'dexscreener' | 'geckoterminal';
  /** Endpoint that answered, so the body can be interpreted later. */
  url?: string;
  /** HTTP status of the recorded response. */
  status?: number;
  /** When the response was received (ISO-8601, UTC). */
  fetchedAt: string;
  /** The response body exactly as returned. */
  body: unknown;
};

/** The signature block the contract verifies on-chain. */
export type ResolutionSignatureEvidence = {
  algorithm: 'ed25519' | 'eip712';
  /** Hex signature (64 bytes for ed25519). */
  signature: string;
  /** Where the key lives: `local`, `hsm` or `evm`. */
  kind: string;
  /** sha256 hex of the exact bytes the signature covers. */
  payloadHash: string;
  /** ed25519 only: the bytes signed, hex (`BytesN<33>` canonical payload). */
  messageHex?: string;
  /** ed25519 only: the public key, hex (`BytesN<32>`). */
  publicKeyHex?: string;
};

/** Everything OracleService knows when a call settles. */
export type OracleResolutionEvidenceInput = {
  /** Numeric call id (the contract's `u64` call id). */
  callId: number;
  /** Service identifier that performed the settlement. */
  actor: string;
  chain?: string;
  /** When the call was resolved; defaults to now. */
  resolvedAt?: string;
  /** The exact payload handed to the signer. */
  resolution: {
    callId: number;
    outcomeIndex: 0 | 1;
    finalPrice: string;
    timestamp: number;
  };
  price: {
    source: 'dexscreener' | 'geckoterminal';
    price: number;
    scaledPrice: string;
  };
  rawApiResponse?: RawPriceEvidence;
  candles?: EvidenceCandle[];
  /** TWAP verdict, when a TWAP filter ran. */
  twap?: Record<string, unknown>;
  /** The call's `conditionJson`. */
  condition?: unknown;
  signature: ResolutionSignatureEvidence;
};

/**
 * The immutable document pinned to IPFS for one settled call.
 *
 * Written as a `type` (not an `interface`) so it stays assignable to
 * `Record<string, unknown>` without an explicit index signature.
 */
export type OracleResolutionEvidenceDocument = {
  /** Schema version of this document. */
  version: typeof EVIDENCE_SCHEMA_VERSION;
  callId: number;
  action: typeof EVIDENCE_DOCUMENT_ACTION;
  actor: string;
  chain: string | null;
  resolvedAt: string;
  /** What the signature authorises — the exact tuple the contract rebuilds. */
  resolution: {
    callId: number;
    outcomeIndex: 0 | 1;
    finalPrice: string;
    timestamp: number;
  };
  price: {
    source: 'dexscreener' | 'geckoterminal';
    price: number;
    scaledPrice: string;
  };
  /** Raw provider response; omitted when the caller could not capture it. */
  rawApiResponse?: RawPriceEvidence;
  /** Candle window the TWAP filter used; omitted when none ran. */
  candles?: EvidenceCandle[];
  twap?: Record<string, unknown>;
  condition: unknown;
  signature: ResolutionSignatureEvidence;
};

/** What `archiveResolutionEvidence` returns. */
export type ArchivedResolutionEvidence = {
  entry: AuditLog;
  evidence: OracleResolutionEvidenceDocument;
  /** Deterministic CIDv1 of the canonical document. */
  cid: string;
  /** sha256 hex of the canonical bytes. */
  digest: string;
  /** True when a pinning provider confirmed it stored the bytes. */
  pinned: boolean;
  gatewayUrls: string[];
};

/** What `getResolutionEvidence` returns — the archive plus its proof. */
export type VerifiedResolutionEvidence = {
  callId: string;
  auditLogId: string;
  archivedAt: Date;
  ipfs: {
    cid: string;
    gatewayUrl: string;
    fallbackGatewayUrls: string[];
    /** sha256 the CID encodes. */
    digest: string;
    /** Byte length of the canonical document. */
    size: number;
    /** The recomputed CID — must equal `cid` for the record to be intact. */
    recomputedCid: string;
  };
  evidence: OracleResolutionEvidenceDocument;
  verification: {
    /** The stored bytes still hash to the CID they claim. */
    documentMatchesCid: boolean;
    /** The stored digest column matches the stored bytes. */
    digestMatches: boolean;
    /** The resolution signature verifies against the stored public key. */
    signatureValid: boolean;
    algorithm: ResolutionSignatureEvidence['algorithm'];
    payloadHash: string;
    publicKeyHex?: string;
    messageHex?: string;
  };
};

/**
 * AuditLogService
 *
 * Provides a single append-only write path for audit entries.
 * No update or delete methods are exposed intentionally.
 *
 * BE-016 adds the resolution-evidence archive on top of that path: the full
 * evidence bundle for a settled call is canonicalised, sealed to IPFS with a
 * deterministic CIDv1, and stored alongside the CID so `GET /oracle/audit/:callId`
 * can prove what was sealed without trusting any gateway.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
    /**
     * Optional: `AdminModule` also provides this service for `GET /admin/audit`
     * and has no reason to depend on IPFS. Archival simply records
     * `pinned: false` when no `IpfsService` is available.
     */
    @Optional()
    private readonly ipfsService?: IpfsService,
  ) {}

  /** Append a new immutable audit entry. */
  async append(params: AppendAuditParams): Promise<AuditLog> {
    const entry = this.repo.create(params);
    return this.repo.save(entry);
  }

  /** Query audit logs by optional callId filter (used by GET /admin/audit). */
  async query(callId?: string): Promise<AuditLog[]> {
    if (callId) {
      return this.repo.find({
        where: { callId },
        order: { createdAt: 'DESC' },
      });
    }
    return this.repo.find({ order: { createdAt: 'DESC' }, take: 200 });
  }

  // ─── BE-016: evidence archival ─────────────────────────────────────────────

  /**
   * Seals the full resolution evidence for a settled call.
   *
   * 1. build the canonical document (deterministic: same inputs, same bytes);
   * 2. derive the CIDv1 from those bytes locally — never from the provider;
   * 3. pin the same bytes to IPFS;
   * 4. append the audit row carrying the CID, the digest, the signature and
   *    the exact canonical bytes.
   *
   * A pinning failure is logged and recorded (`pinned: false`) rather than
   * thrown: the settlement itself has already happened, and losing the archive
   * row would leave the call with no audit trail at all. `pinJson` still fails
   * closed in production, so a production deployment never silently archives
   * nothing.
   *
   * @param input   everything the oracle knows about the resolution
   * @param manager when called inside a transaction, the caller's manager is
   *   used so the audit row commits with the settlement it describes
   */
  async archiveResolutionEvidence(
    input: OracleResolutionEvidenceInput,
    manager?: EntityManager,
  ): Promise<ArchivedResolutionEvidence> {
    const evidence = buildResolutionEvidence(input);
    const canonical = canonicalizeJson(evidence);
    const buffer = Buffer.from(canonical, 'utf8');
    const cid = computeCidV1(buffer, RAW_CODEC);
    const digest = sha256Hex(buffer);

    let pinned = false;
    if (this.ipfsService) {
      try {
        const result = await this.ipfsService.pinJson(
          evidence,
          `oracle-resolution-call-${input.callId}.json`,
        );
        pinned = result.pinned;
        if (result.cid !== cid) {
          // Two implementations of the same content address disagree, which
          // means one of them is wrong. Keep ours (it is verifiable offline)
          // and make the divergence loud.
          this.logger.error(
            `CID mismatch for call ${input.callId}: canonical=${cid} pinned=${result.cid}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to pin resolution evidence for call ${input.callId}: ${(err as Error).message}`,
        );
      }
    } else {
      this.logger.warn(
        `No IpfsService available; archiving call ${input.callId} with pinned=false (cid=${cid})`,
      );
    }

    const row: Partial<AuditLog> = {
      callId: String(input.callId),
      action: AuditLogAction.ORACLE_EVIDENCE_ARCHIVED,
      actor: input.actor,
      payloadHash: input.signature.payloadHash,
      evidenceCid: cid,
      evidenceDigest: digest,
      evidenceDocument: canonical,
      resolutionSignature: input.signature.signature,
      resolutionPublicKey: input.signature.publicKeyHex,
      resolutionMessage: input.signature.messageHex,
      targetResource: `call:${input.callId}`,
      chain: input.chain,
      payload: {
        outcomeIndex: input.resolution.outcomeIndex,
        finalPrice: input.resolution.finalPrice,
        price: input.price.price,
        scaledPrice: input.price.scaledPrice,
        source: input.price.source,
        signatureAlgorithm: input.signature.algorithm,
        cid,
        pinned,
      },
    };

    const entry = manager
      ? await manager.save(AuditLog, manager.create(AuditLog, row))
      : await this.repo.save(this.repo.create(row));

    return {
      entry,
      evidence,
      cid,
      digest,
      pinned,
      gatewayUrls: this.ipfsService?.gatewayUrls(cid) ?? [],
    };
  }

  /**
   * Reads the sealed evidence for a call and re-derives its proof.
   *
   * Nothing stored is trusted: the CID is recomputed from the stored canonical
   * bytes, the digest column is compared with the recomputed one, and the
   * ed25519 signature is verified against the public key recorded in the
   * document. Each of those can fail independently, and each failure is
   * reported rather than collapsed into a generic error.
   */
  async getResolutionEvidence(callId: string): Promise<VerifiedResolutionEvidence | null> {
    const entries = await this.repo.find({
      where: { callId, action: AuditLogAction.ORACLE_EVIDENCE_ARCHIVED },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    const entry = entries[0];
    if (!entry) return null;

    const canonical = entry.evidenceDocument ?? '';
    const bytes = Buffer.from(canonical, 'utf8');
    const recomputedCid = computeCidV1(bytes, RAW_CODEC);
    const digest = sha256Hex(bytes);

    let evidence: OracleResolutionEvidenceDocument;
    try {
      evidence = JSON.parse(canonical) as OracleResolutionEvidenceDocument;
    } catch {
      evidence = {
        version: EVIDENCE_SCHEMA_VERSION,
        callId: Number(callId),
        action: EVIDENCE_DOCUMENT_ACTION,
        actor: entry.actor,
        chain: entry.chain ?? null,
        resolvedAt: entry.createdAt?.toISOString?.() ?? '',
        resolution: {
          callId: Number(callId),
          outcomeIndex: 0,
          finalPrice: '0',
          timestamp: 0,
        },
        price: { source: 'dexscreener', price: 0, scaledPrice: '0' },
        condition: entry.payload ?? null,
        signature: {
          algorithm: 'ed25519',
          signature: entry.resolutionSignature ?? '',
          kind: 'unknown',
          payloadHash: entry.payloadHash ?? '',
        },
      };
    }

    const signature = evidence.signature;
    const signatureValid =
      signature?.algorithm === 'ed25519' &&
      typeof signature.messageHex === 'string' &&
      verifyEd25519Signature(
        Buffer.from(signature.messageHex, 'hex'),
        signature.signature,
        signature.publicKeyHex,
      );

    return {
      callId: entry.callId,
      auditLogId: entry.id,
      archivedAt: entry.createdAt,
      ipfs: {
        cid: entry.evidenceCid ?? '',
        gatewayUrl: entry.evidenceCid
          ? (this.ipfsService?.gatewayUrl(entry.evidenceCid) ??
            `https://ipfs.io/ipfs/${entry.evidenceCid}`)
          : '',
        fallbackGatewayUrls: entry.evidenceCid
          ? (this.ipfsService?.gatewayUrls(entry.evidenceCid) ?? [])
          : [],
        digest,
        size: bytes.length,
        recomputedCid,
      },
      evidence,
      verification: {
        documentMatchesCid:
          Boolean(entry.evidenceCid) &&
          verifyCidV1(entry.evidenceCid ?? '', bytes, RAW_CODEC) &&
          recomputedCid === entry.evidenceCid,
        digestMatches: Boolean(entry.evidenceDigest) && entry.evidenceDigest === digest,
        signatureValid,
        algorithm: signature?.algorithm ?? 'ed25519',
        payloadHash: signature?.payloadHash ?? '',
        publicKeyHex: signature?.publicKeyHex,
        messageHex: signature?.messageHex,
      },
    };
  }
}

/**
 * Builds the sealed evidence document.
 *
 * Pure and deterministic: every field derives from `input`, timestamps come
 * from the caller (or a single `new Date()`), and key order is normalised at
 * serialisation time by `canonicalizeJson`. Calling it twice with the same
 * input yields the same CID.
 */
export function buildResolutionEvidence(
  input: OracleResolutionEvidenceInput,
): OracleResolutionEvidenceDocument {
  if (!Number.isSafeInteger(input.callId) || input.callId < 0) {
    throw new Error(
      `Resolution evidence requires a non-negative safe call id, got ${String(input.callId)}`,
    );
  }
  if (input.resolution.callId !== input.callId) {
    throw new Error(
      `Resolution evidence callId mismatch: ${input.callId} vs payload ${input.resolution.callId}`,
    );
  }

  const document: OracleResolutionEvidenceDocument = {
    version: EVIDENCE_SCHEMA_VERSION,
    callId: input.callId,
    action: EVIDENCE_DOCUMENT_ACTION,
    actor: input.actor,
    chain: input.chain ?? null,
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
    resolution: {
      callId: input.resolution.callId,
      outcomeIndex: input.resolution.outcomeIndex,
      finalPrice: input.resolution.finalPrice,
      timestamp: input.resolution.timestamp,
    },
    price: {
      source: input.price.source,
      price: input.price.price,
      scaledPrice: input.price.scaledPrice,
    },
    condition: input.condition ?? null,
    signature: { ...input.signature },
  };

  if (input.rawApiResponse) {
    document.rawApiResponse = { ...input.rawApiResponse };
  }
  if (input.candles && input.candles.length > 0) {
    document.candles = input.candles.map((candle) => ({ ...candle }));
  }
  if (input.twap) {
    document.twap = { ...input.twap };
  }

  return document;
}
