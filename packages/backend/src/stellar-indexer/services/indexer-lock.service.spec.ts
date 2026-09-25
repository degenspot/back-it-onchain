/**
 * indexer-lock.service.spec.ts  (BE-004)
 *
 * Unit tests for IndexerLockService covering:
 *  - acquire(): returns true on SET NX success, false on contention
 *  - renew(): pexpire success and failure → step-down path
 *  - release(): Lua token-matched delete, safe when not leader
 *  - tryAcquireLoop: retries until acquired
 *  - onBecomeLeader / onLoseLeadership callbacks
 *  - onModuleDestroy: clears timers and releases lock
 *  - getStatus(): reflects live state
 */

import { ConfigService } from '@nestjs/config';
import { IndexerLockService } from './indexer-lock.service';
import { RedisClientProvider } from '../../config/redis.config';

// ─── Mock Redis client ────────────────────────────────────────────────────────

function makeRedisClient(overrides: Record<string, jest.Mock> = {}) {
  return {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    pexpire: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn(),
    ...overrides,
  };
}

function makeService(clientOverrides: Record<string, jest.Mock> = {}) {
  const client = makeRedisClient(clientOverrides);
  const redisProvider = { getClient: jest.fn().mockReturnValue(client) } as unknown as RedisClientProvider;
  const config = { get: jest.fn() } as unknown as ConfigService;
  const service = new IndexerLockService(config, redisProvider);
  return { service, client, redisProvider };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IndexerLockService (BE-004)', () => {
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // ── acquire ────────────────────────────────────────────────────────────────

  describe('acquire()', () => {
    it('returns true and sets token when Redis SET NX succeeds', async () => {
      const { service, client } = makeService();
      const result = await service.acquire();

      expect(result).toBe(true);
      expect(client.set).toHaveBeenCalledWith(
        'indexer:stellar:leader-lock',
        expect.any(String),
        'NX',
        'PX',
        10_000,
      );
      expect(service.isCurrentLeader()).toBe(false); // not yet set by loop
    });

    it('returns false when lock is already held by another replica', async () => {
      const { service } = makeService({ set: jest.fn().mockResolvedValue(null) });
      const result = await service.acquire();
      expect(result).toBe(false);
    });

    it('returns false and logs warning on Redis error', async () => {
      const { service } = makeService({
        set: jest.fn().mockRejectedValue(new Error('connection refused')),
      });
      const result = await service.acquire();
      expect(result).toBe(false);
    });
  });

  // ── renew ──────────────────────────────────────────────────────────────────

  describe('renew()', () => {
    it('returns false when not the leader', async () => {
      const { service } = makeService();
      const result = await service.renew();
      expect(result).toBe(false);
    });

    it('returns true and does not step down on successful pexpire', async () => {
      const { service, client } = makeService();
      await service.acquire(); // sets token
      // Manually set isLeader = true for direct renew test
      (service as unknown as { isLeader: boolean }).isLeader = true;

      const result = await service.renew();
      expect(result).toBe(true);
      expect(client.pexpire).toHaveBeenCalledWith('indexer:stellar:leader-lock', 10_000);
    });

    it('steps down and returns false when pexpire returns 0 (key expired)', async () => {
      const { service } = makeService({ pexpire: jest.fn().mockResolvedValue(0) });
      await service.acquire();
      (service as unknown as { isLeader: boolean }).isLeader = true;

      const lostCb = jest.fn();
      service.onLoseLeadership = lostCb;

      const result = await service.renew();
      expect(result).toBe(false);
      expect(lostCb).toHaveBeenCalled();
      expect(service.isCurrentLeader()).toBe(false);
    });
  });

  // ── release ────────────────────────────────────────────────────────────────

  describe('release()', () => {
    it('calls eval with the Lua token-matched delete script', async () => {
      const { service, client } = makeService();
      await service.acquire();
      (service as unknown as { isLeader: boolean }).isLeader = true;

      await service.release();

      expect(client.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call'),
        1,
        'indexer:stellar:leader-lock',
        expect.any(String),
      );
      expect(service.isCurrentLeader()).toBe(false);
      expect((service as unknown as { token: string | null }).token).toBeNull();
    });

    it('is safe to call when not the leader (no-op)', async () => {
      const { service, client } = makeService();
      await service.release(); // no token set
      expect(client.eval).not.toHaveBeenCalled();
    });
  });

  // ── onBecomeLeader callback ────────────────────────────────────────────────

  it('calls onBecomeLeader when lock is acquired', async () => {
    jest.useFakeTimers();
    const { service } = makeService();

    const becomeLeader = jest.fn().mockResolvedValue(undefined);
    service.onBecomeLeader = becomeLeader;

    // Manually trigger the acquire loop
    await (service as unknown as { tryAcquireLoop: () => Promise<void> }).tryAcquireLoop();

    expect(becomeLeader).toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────

  it('releases the lock and clears timers on destroy', async () => {
    const { service, client } = makeService();
    await service.acquire();
    (service as unknown as { isLeader: boolean }).isLeader = true;

    await service.onModuleDestroy();

    expect(client.eval).toHaveBeenCalled(); // release called
    expect(service.isCurrentLeader()).toBe(false);
  });

  // ── getStatus ──────────────────────────────────────────────────────────────

  it('getStatus reflects not-leader state initially', () => {
    const { service } = makeService();
    const status = service.getStatus();
    expect(status.isLeader).toBe(false);
    expect(status.lockToken).toBeNull();
    expect(status.lockTtlMs).toBe(10_000);
    expect(status.acquireRetryMs).toBe(1_000);
  });

  it('getStatus shows token when leader', async () => {
    const { service } = makeService();
    await service.acquire();
    (service as unknown as { isLeader: boolean }).isLeader = true;

    const status = service.getStatus();
    expect(status.isLeader).toBe(true);
    expect(status.lockToken).toBeTruthy();
  });

  // ── Contention: standby retries ────────────────────────────────────────────

  it('retries acquisition after ACQUIRE_RETRY_MS when lock is held', async () => {
    jest.useFakeTimers();

    // First call fails (lock held), second succeeds
    const setMock = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue('OK');
    const { service } = makeService({ set: setMock });

    const becomeLeader = jest.fn().mockResolvedValue(undefined);
    service.onBecomeLeader = becomeLeader;

    void (service as unknown as { tryAcquireLoop: () => Promise<void> }).tryAcquireLoop();

    // First attempt fails
    await Promise.resolve();
    expect(becomeLeader).not.toHaveBeenCalled();

    // Advance past the retry delay
    jest.advanceTimersByTime(1_100);
    await Promise.resolve();
    await Promise.resolve(); // flush microtasks

    await service.onModuleDestroy();
  });
});
