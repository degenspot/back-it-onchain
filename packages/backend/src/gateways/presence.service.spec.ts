import { PresenceService } from './presence.service';

/**
 * Minimal mock of the ioredis surface PresenceService actually uses: a
 * sorted-set store plus a pipeline() that batches commands and applies
 * them in order on exec(), mirroring ioredis's real semantics closely
 * enough to exercise the prune-then-read/write logic faithfully.
 */
function createMockRedis() {
  const sets = new Map<string, Map<string, number>>();

  function getSet(key: string): Map<string, number> {
    if (!sets.has(key)) sets.set(key, new Map());
    return sets.get(key) as Map<string, number>;
  }

  const redis = {
    zadd: jest.fn(async (key: string, score: number, member: string) => {
      getSet(key).set(member, score);
      return 1;
    }),
    zrem: jest.fn(async (key: string, member: string) => {
      getSet(key).delete(member);
      return 1;
    }),
    zcard: jest.fn(async (key: string) => getSet(key).size),
    zscore: jest.fn(async (key: string, member: string) => {
      const score = getSet(key).get(member);
      return score === undefined ? null : String(score);
    }),
    zremrangebyscore: jest.fn(async (key: string, _min: number, max: number) => {
      const set = getSet(key);
      let removed = 0;
      for (const [member, score] of set.entries()) {
        if (score <= max) {
          set.delete(member);
          removed += 1;
        }
      }
      return removed;
    }),
    pipeline: jest.fn(() => {
      const commands: Array<() => Promise<unknown>> = [];
      const chain = {
        zremrangebyscore: (key: string, min: number, max: number) => {
          commands.push(() => redis.zremrangebyscore(key, min, max));
          return chain;
        },
        zadd: (key: string, score: number, member: string) => {
          commands.push(() => redis.zadd(key, score, member));
          return chain;
        },
        zcard: (key: string) => {
          commands.push(() => redis.zcard(key));
          return chain;
        },
        exec: async () => {
          const results: [Error | null, unknown][] = [];
          for (const command of commands) {
            results.push([null, await command()]);
          }
          return results;
        },
      };
      return chain;
    }),
    __sets: sets,
  };

  return redis;
}

describe('PresenceService', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let service: PresenceService;

  beforeEach(() => {
    redis = createMockRedis();
    service = new PresenceService(redis as never);
  });

  it('records a heartbeat and reflects it in the viewer count', async () => {
    await service.heartbeat('call-1', 'user-a');
    expect(await service.getViewerCount('call-1')).toBe(1);
  });

  it('counts multiple distinct viewers on the same call', async () => {
    await service.heartbeat('call-1', 'user-a');
    await service.heartbeat('call-1', 'user-b');
    expect(await service.getViewerCount('call-1')).toBe(2);
  });

  it('does not double-count repeated heartbeats from the same user', async () => {
    await service.heartbeat('call-1', 'user-a');
    await service.heartbeat('call-1', 'user-a');
    expect(await service.getViewerCount('call-1')).toBe(1);
  });

  it('keeps viewer counts separate per call', async () => {
    await service.heartbeat('call-1', 'user-a');
    await service.heartbeat('call-2', 'user-a');
    expect(await service.getViewerCount('call-1')).toBe(1);
    expect(await service.getViewerCount('call-2')).toBe(1);
  });

  it('expires a viewer after 60s of inactivity', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_000_000);
      await service.heartbeat('call-1', 'user-a');
      expect(await service.getViewerCount('call-1')).toBe(1);

      jest.setSystemTime(1_000_000 + 60_001);
      expect(await service.getViewerCount('call-1')).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('removeViewer drops a user immediately without waiting for TTL', async () => {
    await service.heartbeat('call-1', 'user-a');
    await service.removeViewer('call-1', 'user-a');
    expect(await service.getViewerCount('call-1')).toBe(0);
  });

  it('tracks global online status independent of per-call presence', async () => {
    await service.heartbeat('call-1', 'user-a');
    expect(await service.isOnline('user-a')).toBe(true);
    expect(await service.isOnline('user-b')).toBe(false);
  });

  it('getGlobalOnlineCount reflects distinct users across all calls', async () => {
    await service.heartbeat('call-1', 'user-a');
    await service.heartbeat('call-2', 'user-b');
    await service.heartbeat('call-2', 'user-a'); // same user, different call
    expect(await service.getGlobalOnlineCount()).toBe(2);
  });

  it('a user goes offline globally after their heartbeat expires', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_000_000);
      await service.heartbeat('call-1', 'user-a');
      expect(await service.isOnline('user-a')).toBe(true);

      jest.setSystemTime(1_000_000 + 60_001);
      expect(await service.isOnline('user-a')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
