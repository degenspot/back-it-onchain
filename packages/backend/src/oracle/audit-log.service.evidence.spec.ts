import * as nacl from 'tweetnacl';
import { AuditLogService, buildResolutionEvidence } from './audit-log.service';
import { AuditLog } from './audit-log.entity';
import { RAW_CODEC, canonicalizeJson, computeCidV1, sha256Hex } from '../common/ipfs/cid.util';
import type { IpfsService } from '../ipfs/ipfs.service';

/**
 * BE-016 tests: the audit trail must be reproducible and tamper-evident.
 *
 * Everything here is asserted through the public service API, because the
 * property that matters is "a third party can re-derive this from the stored
 * row", not "the builder calls the right helper".
 */
describe('AuditLogService — resolution evidence archival (BE-016)', () => {
  /** A real ed25519 keypair: the signature in these tests is genuine. */
  const keyPair = nacl.sign.keyPair();
  const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
  const RESOLUTION_MESSAGE = Buffer.alloc(33, 7);
  const signatureHex = Buffer.from(
    nacl.sign.detached(new Uint8Array(RESOLUTION_MESSAGE), keyPair.secretKey),
  ).toString('hex');

  const baseInput = () => ({
    callId: 42,
    actor: 'oracle-worker',
    chain: 'stellar',
    resolvedAt: '2026-01-01T00:00:00.000Z',
    resolution: {
      callId: 42,
      outcomeIndex: 1 as const,
      finalPrice: '25500000000000000000',
      timestamp: 1_767_225_600,
    },
    price: {
      source: 'dexscreener' as const,
      price: 25.5,
      scaledPrice: '25500000000000000000',
    },
    rawApiResponse: {
      source: 'dexscreener' as const,
      url: 'https://api.dexscreener.com/latest/dex/tokens/0xtoken',
      status: 200,
      fetchedAt: '2026-01-01T00:00:00.000Z',
      body: { pairs: [{ priceUsd: '25.5', baseToken: { symbol: 'TOK' } }] },
    },
    candles: [
      { timestamp: 1_767_225_000, close: 25.4, volume: 10 },
      { timestamp: 1_767_225_900, close: 25.6, volume: 12 },
    ],
    twap: { accepted: true, twap: 25.5, deviationSigmas: 0.4 },
    condition: { direction: 'above', targetPrice: 10 },
    signature: {
      algorithm: 'ed25519' as const,
      signature: signatureHex,
      kind: 'local',
      payloadHash: sha256Hex(RESOLUTION_MESSAGE),
      messageHex: RESOLUTION_MESSAGE.toString('hex'),
      publicKeyHex,
    },
  });

  function buildRepo() {
    const rows: AuditLog[] = [];
    return {
      rows,
      create: jest.fn((data: Partial<AuditLog>) => ({ ...data }) as AuditLog),
      save: jest.fn(async (entry: AuditLog) => {
        const saved = {
          id: `uuid-${rows.length + 1}`,
          createdAt: new Date('2026-01-01T00:00:01.000Z'),
          ...entry,
        } as AuditLog;
        rows.push(saved);
        return saved;
      }),
      find: jest.fn(async () => rows.slice().reverse()),
    };
  }

  function buildIpfs() {
    return {
      pinJson: jest.fn(async (document: unknown) => ({
        cid: computeCidV1(Buffer.from(canonicalizeJson(document), 'utf8'), RAW_CODEC),
        digest: sha256Hex(Buffer.from(canonicalizeJson(document), 'utf8')),
        size: canonicalizeJson(document).length,
        providerCid: 'bafkreiprovidercid',
        provider: 'kubo' as const,
        pinned: true,
      })),
      gatewayUrl: (cid: string) => `https://gateway.pinata.cloud/ipfs/${cid}`,
      gatewayUrls: (cid: string) => [
        `https://gateway.pinata.cloud/ipfs/${cid}`,
        `https://ipfs.io/ipfs/${cid}`,
      ],
    };
  }

  const serviceWith = (repo: ReturnType<typeof buildRepo>, ipfs?: ReturnType<typeof buildIpfs>) =>
    new AuditLogService(
      repo as unknown as ConstructorParameters<typeof AuditLogService>[0],
      ipfs as unknown as IpfsService | undefined,
    );

  it('seals the evidence with a deterministic CIDv1 and stores the canonical bytes', async () => {
    const repo = buildRepo();
    const ipfs = buildIpfs();
    const service = serviceWith(repo, ipfs);

    const archived = await service.archiveResolutionEvidence(baseInput());

    const expectedCanonical = canonicalizeJson(archived.evidence);
    expect(archived.cid).toBe(computeCidV1(Buffer.from(expectedCanonical, 'utf8'), RAW_CODEC));
    expect(archived.cid.startsWith('bafkrei')).toBe(true);
    expect(archived.digest).toBe(sha256Hex(Buffer.from(expectedCanonical, 'utf8')));
    expect(archived.pinned).toBe(true);
    expect(archived.gatewayUrls).toEqual([
      `https://gateway.pinata.cloud/ipfs/${archived.cid}`,
      `https://ipfs.io/ipfs/${archived.cid}`,
    ]);

    const row = repo.rows[0]!;
    expect(row.callId).toBe('42');
    expect(row.evidenceCid).toBe(archived.cid);
    expect(row.evidenceDigest).toBe(archived.digest);
    expect(row.evidenceDocument).toBe(expectedCanonical);
    expect(row.resolutionSignature).toBe(signatureHex);
    expect(row.resolutionPublicKey).toBe(publicKeyHex);
    expect(row.payloadHash).toBe(sha256Hex(RESOLUTION_MESSAGE));
  });

  it('carries every piece of evidence the issue asks for', async () => {
    const repo = buildRepo();
    const service = serviceWith(repo, buildIpfs());

    const { evidence } = await service.archiveResolutionEvidence(baseInput());

    expect(evidence.rawApiResponse?.body).toEqual({
      pairs: [{ priceUsd: '25.5', baseToken: { symbol: 'TOK' } }],
    });
    expect(evidence.rawApiResponse?.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(evidence.candles).toHaveLength(2);
    expect(evidence.twap).toEqual({ accepted: true, twap: 25.5, deviationSigmas: 0.4 });
    expect(evidence.resolvedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(evidence.resolution).toEqual({
      callId: 42,
      outcomeIndex: 1,
      finalPrice: '25500000000000000000',
      timestamp: 1_767_225_600,
    });
    expect(evidence.signature.payloadHash).toBe(sha256Hex(RESOLUTION_MESSAGE));
  });

  it('is deterministic: the same resolution seals to the same CID', async () => {
    const first = await serviceWith(buildRepo(), buildIpfs()).archiveResolutionEvidence(
      baseInput(),
    );
    const second = await serviceWith(buildRepo(), buildIpfs()).archiveResolutionEvidence(
      baseInput(),
    );

    expect(first.cid).toBe(second.cid);
    expect(first.evidence).toEqual(second.evidence);
  });

  it('commits through the caller transaction manager when one is given', async () => {
    const repo = buildRepo();
    const service = serviceWith(repo, buildIpfs());
    const savedByManager: AuditLog[] = [];
    const manager = {
      create: jest.fn((_entity: unknown, plain: unknown) => plain),
      save: jest.fn(async (_entity: unknown, entity: AuditLog) => {
        savedByManager.push(entity);
        return { id: 'uuid-managed', createdAt: new Date(), ...entity } as AuditLog;
      }),
    };

    const archived = await service.archiveResolutionEvidence(baseInput(), manager as never);

    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(repo.save).not.toHaveBeenCalled();
    expect(savedByManager[0]!.evidenceCid).toBe(archived.cid);
  });

  it('records pinned=false rather than throwing when no IpfsService is wired', async () => {
    const repo = buildRepo();
    const service = serviceWith(repo);

    const archived = await service.archiveResolutionEvidence(baseInput());

    expect(archived.pinned).toBe(false);
    expect(archived.gatewayUrls).toEqual([]);
    expect(repo.rows[0]!.evidenceCid).toBe(archived.cid);
  });

  it('keeps the archive row when pinning fails, marking it unpinned', async () => {
    const repo = buildRepo();
    const ipfs = buildIpfs();
    ipfs.pinJson.mockRejectedValueOnce(new Error('pinata 500'));
    const service = serviceWith(repo, ipfs);

    const archived = await service.archiveResolutionEvidence(baseInput());

    expect(archived.pinned).toBe(false);
    expect(archived.cid).toMatch(/^bafkrei/);
    expect(repo.rows).toHaveLength(1);
  });

  it('rejects a resolution whose payload callId does not match the record', () => {
    expect(() =>
      buildResolutionEvidence({
        ...baseInput(),
        resolution: { ...baseInput().resolution, callId: 7 },
      }),
    ).toThrow(/callId mismatch/);
  });

  describe('getResolutionEvidence()', () => {
    it('returns null when the call has no archive', async () => {
      const service = serviceWith(buildRepo(), buildIpfs());
      await expect(service.getResolutionEvidence('999')).resolves.toBeNull();
    });

    it('re-derives the CID and verifies the signature of a stored record', async () => {
      const repo = buildRepo();
      const ipfs = buildIpfs();
      const service = serviceWith(repo, ipfs);
      const archived = await service.archiveResolutionEvidence(baseInput());

      const verified = await service.getResolutionEvidence('42');

      expect(verified).not.toBeNull();
      expect(verified!.ipfs.cid).toBe(archived.cid);
      expect(verified!.ipfs.recomputedCid).toBe(archived.cid);
      expect(verified!.ipfs.gatewayUrl).toBe(`https://gateway.pinata.cloud/ipfs/${archived.cid}`);
      expect(verified!.ipfs.fallbackGatewayUrls).toHaveLength(2);
      expect(verified!.ipfs.digest).toBe(archived.digest);
      expect(verified!.ipfs.size).toBe(Buffer.byteLength(repo.rows[0]!.evidenceDocument!, 'utf8'));
      expect(verified!.verification).toMatchObject({
        documentMatchesCid: true,
        digestMatches: true,
        signatureValid: true,
        algorithm: 'ed25519',
        publicKeyHex,
        messageHex: RESOLUTION_MESSAGE.toString('hex'),
      });
      expect(verified!.evidence.candles).toHaveLength(2);
      expect(verified!.auditLogId).toBe(repo.rows[0]!.id);
    });

    it('detects an edited evidence document (CID no longer matches)', async () => {
      const repo = buildRepo();
      const service = serviceWith(repo, buildIpfs());
      await service.archiveResolutionEvidence(baseInput());

      const row = repo.rows[0]!;
      const tampered = JSON.parse(row.evidenceDocument!) as Record<string, unknown>;
      (tampered.price as Record<string, unknown>).price = 999;
      row.evidenceDocument = canonicalizeJson(tampered);

      const verified = await service.getResolutionEvidence('42');

      expect(verified!.verification.documentMatchesCid).toBe(false);
      expect(verified!.verification.digestMatches).toBe(false);
      expect(verified!.verification.signatureValid).toBe(true); // signature still covers its own bytes
    });

    it('detects a tampered digest column', async () => {
      const repo = buildRepo();
      const service = serviceWith(repo, buildIpfs());
      await service.archiveResolutionEvidence(baseInput());
      repo.rows[0]!.evidenceDigest = 'deadbeef';

      const verified = await service.getResolutionEvidence('42');
      expect(verified!.verification.digestMatches).toBe(false);
      expect(verified!.verification.documentMatchesCid).toBe(true);
    });

    it('rejects a signature that does not cover the recorded message', async () => {
      const repo = buildRepo();
      const service = serviceWith(repo, buildIpfs());
      await service.archiveResolutionEvidence(baseInput());

      const row = repo.rows[0]!;
      const flipped = Buffer.from(row.resolutionSignature!, 'hex');
      flipped[0] = flipped[0]! ^ 0xff;
      row.resolutionSignature = flipped.toString('hex');

      const verified = await service.getResolutionEvidence('42');
      expect(verified!.verification.signatureValid).toBe(false);
    });

    it('reports signatureValid=false for a malformed public key instead of throwing', async () => {
      const repo = buildRepo();
      const service = serviceWith(repo, buildIpfs());
      await service.archiveResolutionEvidence(baseInput());
      repo.rows[0]!.resolutionPublicKey = 'not-hex';

      const verified = await service.getResolutionEvidence('42');
      expect(verified!.verification.signatureValid).toBe(false);
    });

    it('keeps the newest archive when a call was settled more than once', async () => {
      const repo = buildRepo();
      const service = serviceWith(repo, buildIpfs());
      await service.archiveResolutionEvidence(baseInput());
      const second = await service.archiveResolutionEvidence({
        ...baseInput(),
        resolvedAt: '2026-02-01T00:00:00.000Z',
      });

      const verified = await service.getResolutionEvidence('42');
      expect(verified!.ipfs.cid).toBe(second.cid);
      expect(verified!.evidence.resolvedAt).toBe('2026-02-01T00:00:00.000Z');
    });

    it('renders the public fallback gateway URL when no IpfsService is wired', async () => {
      const repo = buildRepo();
      const service = serviceWith(repo);
      const archived = await service.archiveResolutionEvidence(baseInput());

      const verified = await service.getResolutionEvidence('42');
      expect(verified!.ipfs.gatewayUrl).toBe(`https://ipfs.io/ipfs/${archived.cid}`);
    });
  });
});
