import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { withRetry } from '../common/rpc/rpc-retry.util';
import {
  RAW_CODEC,
  canonicalizeJson,
  computeCidV1,
  sha256Hex,
  verifyCidV1,
} from '../common/ipfs/cid.util';

/** Which pinning backend accepted a block. */
export type IpfsProvider = 'pinata' | 'kubo';

/** A block that was sealed locally and (optionally) pushed to a provider. */
export interface JsonPinResult {
  /**
   * Deterministic CIDv1 over the canonical bytes. Always present, even when no
   * provider was reachable: it is a property of the bytes, not of the pin.
   */
  cid: string;
  /** sha256 hex of the canonical bytes — the same digest the CID encodes. */
  digest: string;
  /** Byte length of the canonical document. */
  size: number;
  /** CID the provider reported, when one accepted the pin. */
  providerCid?: string;
  /** Where it was pinned, when anywhere. */
  provider?: IpfsProvider;
  /** True only when a provider confirmed it stored the block. */
  pinned: boolean;
}

/** One gateway's answer when validating that a CID is retrievable. */
export interface GatewayProbe {
  url: string;
  reachable: boolean;
  status?: number;
  error?: string;
}

/** Result of asking every configured backend about one CID. */
export interface PinningStatus {
  cid: string;
  /** True when the block is retrievable from anywhere we asked. */
  pinned: boolean;
  /** The pinning backend that confirmed it holds the pin, when one did. */
  provider?: IpfsProvider;
  /** Gateways that were probed, in fallback order. */
  gateways: GatewayProbe[];
  /** First gateway that served the block, when any did. */
  firstReachableGateway?: string;
}

/** Default public gateways, in fallback order. `{cid}` is substituted. */
const DEFAULT_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/{cid}',
  'https://ipfs.io/ipfs/{cid}',
  'https://dweb.link/ipfs/{cid}',
];

/**
 * IpfsService
 *
 * Handles pinning arbitrary buffers (images, JSON) to IPFS.
 *
 * Strategy (in priority order):
 *   1. Pinata REST API (PINATA_JWT) — primary provider
 *   2. Kubo HTTP API    (IPFS_API_URL, default http://localhost:5001)
 *   3. Local fallback   (dev-only — stores nothing, returns a deterministic
 *                        pseudo-CID so the rest of the system keeps working
 *                        without a running IPFS node)
 *
 * All provider calls are wrapped in `withRetry` for resilience.
 *
 * BE-016: JSON documents additionally go through `pinJson()`, which computes
 * the CIDv1 locally from the canonical bytes and therefore does not depend on
 * any provider agreeing with it. See `common/ipfs/cid.util.ts`.
 */
@Injectable()
export class IpfsService {
  private readonly logger = new Logger(IpfsService.name);
  private readonly ipfsApiUrl: string;
  private readonly pinataJwt: string | undefined;
  private readonly gateways: string[];
  private readonly pinCheckTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.ipfsApiUrl = this.configService.get<string>('IPFS_API_URL', 'http://localhost:5001');
    this.pinataJwt = this.configService.get<string>('PINATA_JWT');
    this.gateways = this.resolveGateways(this.configService.get<string>('IPFS_GATEWAYS'));
    this.pinCheckTimeoutMs = Number(
      this.configService.get<string>('IPFS_PIN_CHECK_TIMEOUT_MS', '3000'),
    );
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Pins a buffer to IPFS and returns the resulting CID string.
   * @param buffer  Raw bytes to pin (image, JSON, etc.)
   * @param filename  Logical filename passed to the IPFS API (affects MIME detection)
   */
  async pin(buffer: Buffer, filename = 'file'): Promise<string> {
    try {
      const { cid } = await this.pinWithProviders(buffer, filename);
      return cid;
    } catch (err) {
      this.logger.warn(`No pinning backend accepted ${filename}: ${(err as Error).message}`);
    }

    // Dev fallback — deterministic pseudo-CID (never in production)
    if (this.configService.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn('Falling back to mock CID (dev only)');
      return this.mockCid(buffer);
    }

    throw new ServiceUnavailableException(
      'IPFS upload failed: no reachable IPFS backend configured',
    );
  }

  /**
   * Seals a JSON document to IPFS with a **deterministic CIDv1** (BE-016).
   *
   * Unlike `pin()`, the returned CID never depends on the provider: it is
   * derived from `canonicalizeJson(document)` with the `raw` codec, so the same
   * document always yields the same CID (`bafkrei…`) on every machine and for
   * every provider. A provider is still asked to store the same bytes; when
   * none is reachable the CID is returned anyway, flagged as `pinned: false`,
   * so the audit record can be written and re-pinned later.
   *
   * In production a failed pin is an error: an audit record whose bytes exist
   * nowhere is not an archive.
   */
  async pinJson(document: unknown, filename = 'document.json'): Promise<JsonPinResult> {
    const buffer = Buffer.from(canonicalizeJson(document), 'utf8');
    const cid = computeCidV1(buffer, RAW_CODEC);
    const digest = sha256Hex(buffer);
    const size = buffer.length;

    if (!verifyCidV1(cid, buffer, RAW_CODEC)) {
      // Unreachable unless the canonicaliser is non-deterministic; refusing here
      // is strictly better than storing a CID that describes different bytes.
      throw new ServiceUnavailableException(
        'Refusing to pin a document whose canonical bytes are not stable',
      );
    }

    try {
      const { cid: providerCid, provider } = await this.pinWithProviders(buffer, filename);
      if (providerCid !== cid) {
        // Pinata/Kubo may answer with a different codec or CID version (e.g. a
        // CIDv0 dag-pb wrapper). The audit record keeps the deterministic CID —
        // this only makes the divergence visible.
        this.logger.warn(
          `Provider ${provider} reported CID ${providerCid} for a block whose ` +
            `canonical CID is ${cid}; keeping the deterministic CID`,
        );
      }
      return { cid, digest, size, providerCid, provider, pinned: true };
    } catch (err) {
      this.logger.warn(
        `No pinning backend accepted ${filename} (${cid}): ${(err as Error).message}`,
      );
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException(
          `IPFS pin failed for ${cid}: no reachable IPFS backend configured`,
        );
      }
      return { cid, digest, size, pinned: false };
    }
  }

  /**
   * Fetches raw bytes for a given CID from IPFS.
   * Tries Kubo first, then the configured public gateways.
   */
  async fetch(cid: string): Promise<Buffer> {
    // 1. Try Kubo
    try {
      const res = await globalThis.fetch(`${this.ipfsApiUrl}/api/v0/cat?arg=${cid}`, {
        method: 'POST',
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      // fall through
    }

    // 2. Public gateways
    for (const gateway of this.gatewayUrls(cid)) {
      try {
        const res = await globalThis.fetch(gateway);
        if (res.ok) return Buffer.from(await res.arrayBuffer());
      } catch {
        // try next
      }
    }

    throw new ServiceUnavailableException(`Could not fetch CID ${cid} from any gateway`);
  }

  // ─── Gateway + pin-status helpers (BE-016) ─────────────────────────────────

  /** The configured gateway templates, in fallback order. */
  getGatewayTemplates(): string[] {
    return [...this.gateways];
  }

  /** The primary gateway URL for a CID. */
  gatewayUrl(cid: string): string {
    return this.renderGateway(this.gateways[0]!, cid);
  }

  /** Every fallback gateway URL for a CID, primary first. */
  gatewayUrls(cid: string): string[] {
    return this.gateways.map((template) => this.renderGateway(template, cid));
  }

  /**
   * Validates that a CID is actually retrievable, per the issue's
   * "validate IPFS pinning status with fallback gateways" guideline:
   *
   *   1. ask the local Kubo node whether it holds the pin (authoritative when
   *      a node is configured) — Pinata's own pin list is not consulted because
   *      it matches on the CIDv0 form of a block and would report a CIDv1 record
   *      as missing;
   *   2. probe the gateways in fallback order and stop at the first one that
   *      serves the block, so a degraded gateway does not add its timeout to
   *      every request.
   *
   * Never throws: an unreachable network reports `pinned: false` instead of
   * failing the caller's response.
   */
  async validatePinning(cid: string): Promise<PinningStatus> {
    const status: PinningStatus = { cid, pinned: false, gateways: [] };

    try {
      const res = await globalThis.fetch(
        `${this.ipfsApiUrl}/api/v0/pin/ls?arg=${encodeURIComponent(cid)}&type=recursive`,
        { method: 'POST', signal: AbortSignal.timeout(this.pinCheckTimeoutMs) },
      );
      if (res.ok) {
        status.pinned = true;
        status.provider = 'kubo';
      }
    } catch {
      // No local node — the gateway probes below are the remaining evidence.
    }

    for (const url of this.gatewayUrls(cid)) {
      const probe = await this.probeGateway(url);
      status.gateways.push(probe);
      if (probe.reachable) {
        status.pinned = true;
        status.firstReachableGateway = url;
        break;
      }
    }

    return status;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Pins a buffer through the configured providers, in priority order, without
   * any mock fallback. Throws when no provider accepted the block.
   */
  private async pinWithProviders(
    buffer: Buffer,
    filename: string,
  ): Promise<{ cid: string; provider: IpfsProvider }> {
    if (this.pinataJwt) {
      try {
        const cid = await withRetry(() => this.pinViaPinata(buffer, filename), {
          maxAttempts: 3,
          operationName: 'ipfs.pinata',
        });
        return { cid, provider: 'pinata' };
      } catch (err) {
        this.logger.warn(`Pinata upload failed: ${(err as Error).message}`);
      }
    }

    try {
      const cid = await withRetry(() => this.pinViaKubo(buffer, filename), {
        maxAttempts: 3,
        operationName: 'ipfs.kubo',
      });
      return { cid, provider: 'kubo' };
    } catch (err) {
      this.logger.warn(`Kubo upload failed: ${(err as Error).message}`);
    }

    throw new Error('no reachable IPFS backend configured');
  }

  /** HEAD/GET a gateway URL and report whether it served the block. */
  private async probeGateway(url: string): Promise<GatewayProbe> {
    try {
      const res = await globalThis.fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(this.pinCheckTimeoutMs),
      });
      return { url, reachable: res.ok, status: res.status };
    } catch (err) {
      return { url, reachable: false, error: (err as Error).message };
    }
  }

  private resolveGateways(configured?: string): string[] {
    const list = (configured ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return list.length > 0 ? list : [...DEFAULT_GATEWAYS];
  }

  /** Substitutes `{cid}`, appending the canonical path when absent. */
  private renderGateway(template: string, cid: string): string {
    if (template.includes('{cid}')) return template.replace(/\{cid\}/g, cid);
    return `${template.replace(/\/$/, '')}/ipfs/${cid}`;
  }

  /**
   * Pins a buffer via the Kubo HTTP RPC API (/api/v0/add).
   *
   * `cid-version=1&raw-leaves=true` keeps a single-file pin addressable by the
   * same CIDv1 `pinJson()` computes locally, instead of Kubo's CIDv0 default.
   */
  private async pinViaKubo(buffer: Buffer, filename: string): Promise<string> {
    const formData = new FormData();
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    formData.append('file', new Blob([ab]), filename);

    const res = await globalThis.fetch(
      `${this.ipfsApiUrl}/api/v0/add?pin=true&cid-version=1&raw-leaves=true`,
      {
        method: 'POST',
        body: formData,
      },
    );

    if (!res.ok) {
      throw new Error(`Kubo responded ${res.status}: ${await res.text()}`);
    }

    // Kubo returns NDJSON — last line contains the root CID
    const text = await res.text();
    const lastLine = text.trim().split('\n').pop()!;
    const json = JSON.parse(lastLine) as { Hash: string };
    return json.Hash;
  }

  /**
   * Pins a buffer via the Pinata REST API (pinFileToIPFS).
   */
  private async pinViaPinata(buffer: Buffer, filename: string): Promise<string> {
    const formData = new FormData();
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    formData.append('file', new Blob([ab]), filename);

    const res = await globalThis.fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.pinataJwt}` },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Pinata responded ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { IpfsHash: string };
    return json.IpfsHash;
  }

  /** Returns a deterministic pseudo-CID from the buffer's SHA-256 (dev only). */
  private mockCid(buffer: Buffer): string {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return `Qm${hash.substring(0, 44)}`;
  }
}
