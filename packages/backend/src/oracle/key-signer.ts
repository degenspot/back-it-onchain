import { Logger } from '@nestjs/common';
import { ethers } from 'ethers';

/**
 * key-signer.ts
 *
 * KMS / Vault abstraction for EIP-712 signing (BE-02).
 *
 * Two implementations are provided behind the same `IKeySigner` contract:
 *
 *   - LocalWalletSigner  wraps an in-process `ethers.Wallet` built from
 *     ORACLE_PRIVATE_KEY. This is the default and is intended for local
 *     development / single-instance deployments.
 *
 *   - KmsSigner  delegates the actual signing to a remote key-management
 *     endpoint (KMS_URL), so the raw private key never lives in process
 *     memory. The wire format is a small transit-style HTTP contract:
 *
 *       POST {KMS_URL}/sign
 *       { keyId, domain, types, message }
 *       -> { signature: "0x...", address: "0x..." }
 *
 *       GET {KMS_URL}/address?keyId=...
 *       -> { address: "0x..." }
 *
 *     This keeps OracleService fully decoupled from *which* KMS/Vault
 *     product sits behind KMS_URL — swapping to AWS KMS, GCP KMS or
 *     Hashicorp Vault's transit engine is just a different adapter behind
 *     the same interface.
 */

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract?: string;
}

export type Eip712Types = Record<string, Array<{ name: string; type: string }>>;

export interface IKeySigner {
  /** Returns the checksummed EVM address this signer signs on behalf of. */
  getAddress(): Promise<string>;

  /** Produces an EIP-712 signature over the given typed data. */
  signTypedData(
    domain: Eip712Domain,
    types: Eip712Types,
    value: Record<string, unknown>,
  ): Promise<string>;

  /** Human-readable label for logging/audit purposes. */
  readonly kind: 'local' | 'kms';
}

/**
 * Signs locally using an ethers.Wallet held in process memory.
 * Supports hot-swapping the underlying key via rotate() for BE-02's
 * key-rotation requirement.
 */
export class LocalWalletSigner implements IKeySigner {
  readonly kind = 'local' as const;
  private wallet: ethers.Wallet;

  constructor(privateKey: string) {
    this.wallet = new ethers.Wallet(privateKey);
  }

  getAddress(): Promise<string> {
    return Promise.resolve(this.wallet.address);
  }

  async signTypedData(
    domain: Eip712Domain,
    types: Eip712Types,
    value: Record<string, unknown>,
  ): Promise<string> {
    return this.wallet.signTypedData(domain, types, value);
  }

  /** Replaces the active key in place. Used by OracleService.rotateOracleKey(). */
  rotate(newPrivateKey: string): void {
    this.wallet = new ethers.Wallet(newPrivateKey);
  }
}

/**
 * Signs via a remote KMS/Vault-style HTTP endpoint. The private key
 * material never enters this process.
 */
export class KmsSigner implements IKeySigner {
  readonly kind = 'kms' as const;
  private readonly logger = new Logger(KmsSigner.name);

  constructor(
    private readonly kmsUrl: string,
    private keyId: string,
    private readonly apiToken?: string,
  ) {}

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiToken) headers.Authorization = `Bearer ${this.apiToken}`;
    return headers;
  }

  async getAddress(): Promise<string> {
    const res = await fetch(
      `${this.kmsUrl}/address?keyId=${encodeURIComponent(this.keyId)}`,
      { headers: this.headers, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) {
      throw new Error(
        `KMS address lookup failed: ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json()) as { address: string };
    return body.address;
  }

  async signTypedData(
    domain: Eip712Domain,
    types: Eip712Types,
    value: Record<string, unknown>,
  ): Promise<string> {
    const res = await fetch(`${this.kmsUrl}/sign`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        keyId: this.keyId,
        domain,
        types,
        message: value,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      throw new Error(`KMS signing failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as { signature: string };
    if (!body.signature) {
      throw new Error('KMS response did not include a signature');
    }
    return body.signature;
  }

  /** Points this signer at a new key alias/id. Used for key rotation. */
  rotate(newKeyId: string): void {
    this.logger.warn(
      `Rotating KMS key alias from ${this.keyId} to ${newKeyId}`,
    );
    this.keyId = newKeyId;
  }
}
