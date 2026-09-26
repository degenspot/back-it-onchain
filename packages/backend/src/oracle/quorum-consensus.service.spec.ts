import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ethers } from 'ethers';

import {
  InMemoryQuorumTransport,
  QuorumConsensusService,
  ResolutionPayload,
} from './quorum-consensus.service';

/**
 * Multi-signer simulation for BE-017.
 *
 * Every node is a real `ethers.Wallet`, every vote is a real EIP-712
 * signature, and the nodes talk to the service over a shared in-process
 * transport — the same publish/subscribe contract the Redis transport
 * implements. Nothing is stubbed except the wire.
 */

const CHANNEL = 'oracle:resolution:test';

const DOMAIN = {
  name: 'BackItOnchainOracle',
  version: '1',
  chainId: 8453,
};

const TYPES = {
  Resolution: [
    { name: 'marketId', type: 'uint256' },
    { name: 'outcome', type: 'uint8' },
    { name: 'resolvedAt', type: 'uint256' },
  ],
};

// Fixed keys: an oracle node set that changes between runs would make the
// rejection cases unreproducible.
const NODE_KEYS = [
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
];

const FRAUD_KEYS = [
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
];

const nodes = NODE_KEYS.map((key) => new ethers.Wallet(key));
const frauds = FRAUD_KEYS.map((key) => new ethers.Wallet(key));
const addresses = nodes.map((wallet) => wallet.address);

function payload(outcome = 1): ResolutionPayload {
  return {
    domain: DOMAIN,
    types: TYPES,
    value: { marketId: 42, outcome, resolvedAt: 1_760_000_000 },
  };
}

function configService(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    ORACLE_QUORUM_THRESHOLD: '3',
    ORACLE_QUORUM_TIMEOUT_MS: '200',
    ORACLE_QUORUM_CHANNEL: CHANNEL,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

interface SimulatedNode {
  release: () => Promise<void>;
}

/**
 * Wires one simulated node: it answers every resolution-request by signing
 * whatever `sign` returns, or stays silent when `sign` returns null.
 */
async function joinNode(
  transport: InMemoryQuorumTransport,
  sign: (request: {
    payload: ResolutionPayload;
    roundId: string;
  }) => Promise<string | null> | string | null,
): Promise<SimulatedNode> {
  const handle = async (message: unknown): Promise<void> => {
    const request = message as {
      type?: string;
      roundId?: string;
      payload?: ResolutionPayload;
    };
    if (
      request?.type !== 'resolution-request' ||
      !request.payload ||
      !request.roundId
    ) {
      return;
    }
    const signature = await sign({
      payload: request.payload,
      roundId: request.roundId,
    });
    if (!signature) return;
    await transport.publish(CHANNEL, {
      type: 'resolution-vote',
      roundId: request.roundId,
      signature,
    });
  };

  const release = await transport.subscribe(CHANNEL, (message) => {
    void handle(message);
  });
  return { release };
}

const honest =
  (wallet: ethers.Wallet) => async (request: { payload: ResolutionPayload }) =>
    wallet.signTypedData(
      request.payload.domain,
      request.payload.types,
      request.payload.value,
    );

describe('QuorumConsensusService – multi-signer simulation', () => {
  let transport: InMemoryQuorumTransport;
  let service: QuorumConsensusService;
  let release: Array<() => Promise<void>>;

  beforeEach(() => {
    transport = new InMemoryQuorumTransport();
    service = new QuorumConsensusService(configService(), transport);
    service.registerNodes(addresses);
    release = [];
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    for (const fn of release) await fn();
  });

  async function joinAll(
    specs: Array<
      (request: {
        payload: ResolutionPayload;
        roundId: string;
      }) => Promise<string | null> | string | null
    >,
  ): Promise<void> {
    for (const spec of specs) {
      const node = await joinNode(transport, spec);
      release.push(node.release);
    }
  }

  test('reaches consensus once M distinct nodes agree on the payload', async () => {
    await joinAll(nodes.map((wallet) => honest(wallet)));

    const result = await service.resolve(payload());

    expect(result.converged).toBe(true);
    expect(result.signers).toHaveLength(3);
    expect(result.signatures).toHaveLength(3);
    expect(result.rejections).toEqual([]);
    expect(result.threshold).toBe(3);
    expect(result.nodeCount).toBe(5);
    // Every signer is a registered node, and each one only once.
    for (const signer of result.signers)
      expect(addresses).toContainEqual(ethers.getAddress(signer));
    expect(new Set(result.signers).size).toBe(result.signers.length);
    expect(result.aggregate).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('logs how long consensus took', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    await joinAll(nodes.map((wallet) => honest(wallet)));

    await service.resolve(payload());

    const line = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(line).toMatch(/quorum reached for round /);
    expect(line).toMatch(/\d+ms/);
    expect(line).toMatch(/3\/3 signers/);
  });

  test('rejects a signature from an address outside the node set', async () => {
    await joinAll([
      honest(nodes[0]),
      honest(nodes[1]),
      // Signs correctly, but this key is not a registered oracle node.
      honest(frauds[0]),
    ]);

    const result = await service.resolve(payload());

    expect(result.converged).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(result.rejections.map((r) => r.reason)).toContain('unknown-signer');
    expect(result.rejections[0].detail).toBe(frauds[0].address);
    // The fraudulent vote never counted towards the threshold.
    expect(result.signers).toHaveLength(2);
  });

  test('rejects a node that signs a different outcome', async () => {
    await joinAll([
      honest(nodes[0]),
      honest(nodes[1]),
      // Same key, same round, different payload: a deviating node.
      async (request) =>
        nodes[2].signTypedData(request.payload.domain, request.payload.types, {
          ...request.payload.value,
          outcome: 0,
        }),
    ]);

    const result = await service.resolve(payload());

    expect(result.converged).toBe(false);
    expect(result.rejections).toHaveLength(1);
    expect(['unknown-signer', 'unverifiable']).toContain(
      result.rejections[0].reason,
    );
    expect(result.signers).toHaveLength(2);
  });

  test('a node voting twice counts once', async () => {
    await joinAll([honest(nodes[0]), honest(nodes[0]), () => null]);

    const result = await service.resolve(payload(), {
      threshold: 2,
      timeoutMs: 60,
    });

    expect(result.converged).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(result.signers).toHaveLength(1);
  });

  test('aborts on the deadline when too few nodes answer, without throwing', async () => {
    // Only one of five answers, threshold is three.
    await joinAll([
      honest(nodes[0]),
      () => null,
      () => null,
      () => null,
      () => null,
    ]);

    const result = await service.resolve(payload(), { timeoutMs: 80 });

    expect(result.converged).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(result.latencyMs).toBeGreaterThanOrEqual(75);
    expect(result.signers).toHaveLength(1);
  });

  test('fails fast when the threshold is above the node count instead of waiting', async () => {
    await joinAll([]);

    const result = await service.resolve(payload(), {
      threshold: 9,
      timeoutMs: 5_000,
    });

    expect(result.converged).toBe(false);
    expect(result.reason).toBe('no-nodes');
    expect(result.latencyMs).toBeLessThan(200);
    expect(result.rejections[0].detail).toMatch(
      /threshold 9 exceeds node count 5/,
    );
  });

  test('reports no-transport instead of hanging when no transport is wired', async () => {
    const withoutTransport = new QuorumConsensusService(configService());
    withoutTransport.registerNodes(addresses);

    const result = await withoutTransport.resolve(payload());

    expect(result.converged).toBe(false);
    expect(result.reason).toBe('no-transport');
    expect(result.latencyMs).toBeLessThan(100);
  });

  test('binds signatures to the payload regardless of key order', () => {
    const a = service.hashPayload(payload());
    const reordered: ResolutionPayload = {
      domain: { version: '1', chainId: 8453, name: 'BackItOnchainOracle' },
      types: TYPES,
      value: { resolvedAt: 1_760_000_000, outcome: 1, marketId: 42 },
    };

    expect(service.hashPayload(reordered)).toBe(a);
    expect(service.hashPayload(payload(2))).not.toBe(a);
  });
});

describe('QuorumConsensusService – node registry', () => {
  let service: QuorumConsensusService;

  beforeEach(() => {
    service = new QuorumConsensusService(
      configService(),
      new InMemoryQuorumTransport(),
    );
  });

  test('malformed addresses are ignored and reported, not registered', () => {
    const { registered, ignored } = service.registerNodes([
      addresses[0],
      'not-an-address',
      '',
    ]);

    expect(registered).toBe(1);
    expect(ignored).toEqual(['not-an-address', '']);
    expect(service.getNodes()).toEqual([addresses[0].toLowerCase()]);
  });

  test('the same key in checksummed and lowercase form is one node', () => {
    service.registerNodes([addresses[1], addresses[1].toLowerCase()]);

    expect(service.getNodes()).toHaveLength(1);
  });

  test('a node set larger than the supported maximum is refused', () => {
    const many = Array.from(
      { length: 65 },
      () => ethers.Wallet.createRandom().address,
    );

    expect(() => service.registerNodes(many)).toThrow(/node set too large/);
  });

  test('falls back to defaults for absent or nonsense configuration', () => {
    const withBadConfig = new QuorumConsensusService(
      configService({
        ORACLE_QUORUM_THRESHOLD: 'zero',
        ORACLE_QUORUM_TIMEOUT_MS: '-5',
      }),
    );

    expect(withBadConfig.getConfig()).toEqual({
      threshold: 2,
      timeoutMs: 5_000,
      channel: CHANNEL,
    });
  });
});
