import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * IpfsService
 *
 * Handles pinning arbitrary buffers (images, JSON) to IPFS.
 *
 * Strategy (in priority order):
 *   1. Kubo HTTP API  (IPFS_API_URL, default http://localhost:5001)
 *   2. Pinata REST API (PINATA_JWT)
 *   3. Local mock       (dev-only fallback — stores nothing, returns a
 *                        deterministic pseudo-CID so the rest of the
 *                        system keeps working without a running IPFS node)
 */
@Injectable()
export class IpfsService {
  private readonly logger = new Logger(IpfsService.name);
  private readonly ipfsApiUrl: string;
  private readonly pinataJwt: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.ipfsApiUrl = this.configService.get<string>(
      'IPFS_API_URL',
      'http://localhost:5001',
    );
    this.pinataJwt = this.configService.get<string>('PINATA_JWT');
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Pins a buffer to IPFS and returns the resulting CID string.
   * @param buffer  Raw bytes to pin (image, JSON, etc.)
   * @param filename  Logical filename passed to the IPFS API (affects MIME detection)
   */
  async pin(buffer: Buffer, filename = 'file'): Promise<string> {
    // 1. Try Kubo
    try {
      return await this.pinViaKubo(buffer, filename);
    } catch (err) {
      this.logger.warn(`Kubo upload failed, trying Pinata: ${(err as Error).message}`);
    }

    // 2. Try Pinata
    if (this.pinataJwt) {
      try {
        return await this.pinViaPinata(buffer, filename);
      } catch (err) {
        this.logger.warn(`Pinata upload failed: ${(err as Error).message}`);
      }
    }

    // 3. Dev fallback — deterministic pseudo-CID (never in production)
    if (this.configService.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn('Falling back to mock CID (dev only)');
      return this.mockCid(buffer);
    }

    throw new ServiceUnavailableException(
      'IPFS upload failed: no reachable IPFS backend configured',
    );
  }

  /**
   * Fetches raw bytes for a given CID from IPFS.
   * Tries Kubo first, then public gateways.
   */
  async fetch(cid: string): Promise<Buffer> {
    // 1. Try Kubo
    try {
      const res = await globalThis.fetch(
        `${this.ipfsApiUrl}/api/v0/cat?arg=${cid}`,
        { method: 'POST' },
      );
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      // fall through
    }

    // 2. Public gateway
    for (const gateway of [
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
    ]) {
      try {
        const res = await globalThis.fetch(gateway);
        if (res.ok) return Buffer.from(await res.arrayBuffer());
      } catch {
        // try next
      }
    }

    throw new ServiceUnavailableException(`Could not fetch CID ${cid} from any gateway`);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Pins a buffer via the Kubo HTTP RPC API (/api/v0/add).
   */
  private async pinViaKubo(buffer: Buffer, filename: string): Promise<string> {
    const formData = new FormData();
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    formData.append('file', new Blob([ab]), filename);

    const res = await globalThis.fetch(`${this.ipfsApiUrl}/api/v0/add?pin=true`, {
      method: 'POST',
      body: formData,
    });

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
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    formData.append('file', new Blob([ab]), filename);

    const res = await globalThis.fetch(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.pinataJwt}` },
        body: formData,
      },
    );

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
