import { Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

/**
 * Real-time presence tracking via Redis Sorted Sets (BE-025).
 *
 * Each call/room gets its own sorted set (`presence:call:{callId}`) and
 * there's one global set (`presence:global`), keyed by member (user or
 * socket id) with score = last-heartbeat unix timestamp (ms). A member
 * counts as "online"/"viewing" only if their heartbeat is within the last
 * `TTL_MS` (60s) — `ZREMRANGEBYSCORE` prunes anything older before every
 * read or write, so counts never need a separate expiry sweep job.
 *
 * Takes the `ioredis` client via constructor injection rather than a
 * hardcoded module-level connection, so it's driven directly in tests with
 * a mock client. Wiring a real `Redis` instance as a provider in
 * `GatewaysModule` (and calling `heartbeat` from `events.gateway.ts` on
 * socket ping) is a follow-up left for a maintainer, out of scope for this
 * single-file change.
 */

const TTL_MS = 60_000;

function presenceKey(callId: string): string {
  return `presence:call:${callId}`;
}

const GLOBAL_PRESENCE_KEY = 'presence:global';

@Injectable()
export class PresenceService {
  constructor(private readonly redis: Redis) {}

  /**
   * Records a heartbeat for `userId` viewing `callId`, and marks them
   * globally online. Prunes stale entries from both sets first, in the
   * same atomic pipeline as the writes.
   */
  async heartbeat(callId: string, userId: string): Promise<void> {
    const now = Date.now();
    const cutoff = now - TTL_MS;

    await this.redis
      .pipeline()
      .zremrangebyscore(presenceKey(callId), 0, cutoff)
      .zadd(presenceKey(callId), now, userId)
      .zremrangebyscore(GLOBAL_PRESENCE_KEY, 0, cutoff)
      .zadd(GLOBAL_PRESENCE_KEY, now, userId)
      .exec();
  }

  /**
   * Removes `userId` from `callId`'s viewer set immediately (e.g. on
   * explicit "leave room" or socket disconnect), rather than waiting for
   * the 60s TTL to lapse.
   */
  async removeViewer(callId: string, userId: string): Promise<void> {
    await this.redis.zrem(presenceKey(callId), userId);
  }

  /**
   * Current viewer count for `callId` — members with a heartbeat within
   * the last 60s. Prunes stale entries before counting.
   */
  async getViewerCount(callId: string): Promise<number> {
    const cutoff = Date.now() - TTL_MS;
    const results = (await this.redis
      .pipeline()
      .zremrangebyscore(presenceKey(callId), 0, cutoff)
      .zcard(presenceKey(callId))
      .exec()) as [Error | null, number][];

    return results[1][1];
  }

  /** Total distinct users online globally (heartbeat within the last 60s). */
  async getGlobalOnlineCount(): Promise<number> {
    const cutoff = Date.now() - TTL_MS;
    const results = (await this.redis
      .pipeline()
      .zremrangebyscore(GLOBAL_PRESENCE_KEY, 0, cutoff)
      .zcard(GLOBAL_PRESENCE_KEY)
      .exec()) as [Error | null, number][];

    return results[1][1];
  }

  /** Whether `userId` has a heartbeat within the last 60s, anywhere. */
  async isOnline(userId: string): Promise<boolean> {
    const cutoff = Date.now() - TTL_MS;
    await this.redis.zremrangebyscore(GLOBAL_PRESENCE_KEY, 0, cutoff);
    const score = await this.redis.zscore(GLOBAL_PRESENCE_KEY, userId);
    return score !== null;
  }
}
