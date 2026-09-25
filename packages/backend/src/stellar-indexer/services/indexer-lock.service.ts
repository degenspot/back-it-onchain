/**
 * indexer-lock.service.ts  (BE-004)
 *
 * Distributed exclusive lock for the Stellar indexer using a Redlock-style
 * algorithm on top of the existing Redis infrastructure.
 *
 * Algorithm
 * ──────────
 *  1. acquire(): SET key <token> NX PX <ttlMs> — atomic; only one replica
 *     succeeds.
 *  2. renew():   PEXPIRE key <ttlMs> — resets the TTL while the leader is
 *     alive. Called by an auto-renew interval every ttlMs/2.
 *  3. release(): Lua script — DEL key only if value == token (guards against
 *     accidentally deleting another instance's lock after a clock drift).
 *
 * Failover
 * ─────────
 *  If the leader process dies without releasing, Redis expires the key after
 *  `lockTtlMs` (default 10 s). The standby loop polls every
 *  `acquireRetryMs` (default 1 s) until it wins and resumes from the last
 *  committed ledger checkpoint.
 *
 * Lifecycle
 * ──────────
 *  - onModuleInit: starts acquisition loop
 *  - onModuleDestroy: releases lock and clears timers cleanly
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { RedisClientProvider } from '../../config/redis.config';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis key for the indexer leader lock. */
const LOCK_KEY = 'indexer:stellar:leader-lock';

/** Auto-expiry on the lock in milliseconds (10 s). */
const LOCK_TTL_MS = 10_000;

/** Renewal interval = half the TTL to ensure continuous leadership. */
const RENEW_INTERVAL_MS = LOCK_TTL_MS / 2;

/** How long to wait between acquire attempts when not the leader. */
const ACQUIRE_RETRY_MS = 1_000;

/**
 * Lua script: atomically delete the key only if its value matches `token`.
 * Prevents a slow/crashed former leader from deleting the new leader's lock.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

// ─── Public status shape ──────────────────────────────────────────────────────

export interface IndexerLockStatus {
  isLeader: boolean;
  lockToken: string | null;
  lockTtlMs: number;
  acquireRetryMs: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class IndexerLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerLockService.name);

  private token: string | null = null;
  private isLeader = false;
  private renewTimer: NodeJS.Timeout | null = null;
  private acquireTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  /** Callback invoked when this node becomes the leader. */
  onBecomeLeader?: () => void | Promise<void>;
  /** Callback invoked when this node loses leadership (eviction / network partition). */
  onLoseLeadership?: () => void | Promise<void>;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisClientProvider: RedisClientProvider,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `IndexerLockService initialised — TTL=${LOCK_TTL_MS}ms, retry=${ACQUIRE_RETRY_MS}ms`,
    );
    // Start the acquisition loop immediately
    void this.tryAcquireLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    this.clearTimers();
    await this.release();
    this.logger.log('IndexerLockService destroyed — lock released.');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getStatus(): IndexerLockStatus {
    return {
      isLeader: this.isLeader,
      lockToken: this.isLeader ? this.token : null,
      lockTtlMs: LOCK_TTL_MS,
      acquireRetryMs: ACQUIRE_RETRY_MS,
    };
  }

  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  // ── Acquisition loop ──────────────────────────────────────────────────────

  /**
   * Continuously tries to acquire the lock until it succeeds (or the module
   * is destroyed). When acquired, starts the auto-renew timer.
   */
  private async tryAcquireLoop(): Promise<void> {
    if (this.destroyed) return;

    const acquired = await this.acquire();

    if (acquired) {
      this.isLeader = true;
      this.logger.log(`Leadership acquired (token=${this.token?.slice(0, 8)}...)`);
      this.startRenewLoop();

      if (this.onBecomeLeader) {
        try {
          await this.onBecomeLeader();
        } catch (err) {
          this.logger.error('onBecomeLeader callback threw:', err);
        }
      }
    } else {
      if (!this.destroyed) {
        this.acquireTimer = setTimeout(() => {
          void this.tryAcquireLoop();
        }, ACQUIRE_RETRY_MS);
      }
    }
  }

  // ── Lock primitives ────────────────────────────────────────────────────────

  /**
   * Attempts a single lock acquisition.
   * Generates a fresh crypto token so each replica's ownership is unique.
   */
  async acquire(): Promise<boolean> {
    const client = this.redisClientProvider.getClient();
    const token = randomBytes(20).toString('hex');

    try {
      const result = await client.set(LOCK_KEY, token, 'NX', 'PX', LOCK_TTL_MS);
      if (result === 'OK') {
        this.token = token;
        this.logger.debug(`Lock acquired: token=${token.slice(0, 8)}...`);
        return true;
      }
      return false;
    } catch (err) {
      this.logger.warn(`Lock acquire error: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Renews the TTL on an already-held lock.
   * Returns false if the renewal fails (e.g. key expired between ticks).
   */
  async renew(): Promise<boolean> {
    if (!this.token || !this.isLeader) return false;
    const client = this.redisClientProvider.getClient();

    try {
      const result = await client.pexpire(LOCK_KEY, LOCK_TTL_MS);
      if (result === 1) {
        this.logger.debug(`Lock renewed (token=${this.token.slice(0, 8)}...)`);
        return true;
      }

      // Key expired / not found — we lost leadership
      this.logger.warn('Lock renewal failed — key expired. Stepping down.');
      await this.stepDown();
      return false;
    } catch (err) {
      this.logger.warn(`Lock renew error: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Releases the lock via the Lua script (token-matched delete).
   * Safe to call even if we are not the current leader.
   */
  async release(): Promise<void> {
    if (!this.token) return;
    const client = this.redisClientProvider.getClient();

    try {
      await client.eval(RELEASE_SCRIPT, 1, LOCK_KEY, this.token);
      this.logger.debug(`Lock released (token=${this.token.slice(0, 8)}...)`);
    } catch (err) {
      this.logger.warn(`Lock release error: ${(err as Error).message}`);
    } finally {
      this.token = null;
      this.isLeader = false;
    }
  }

  // ── Auto-renew ────────────────────────────────────────────────────────────

  private startRenewLoop(): void {
    this.renewTimer = setInterval(() => {
      void this.renew();
    }, RENEW_INTERVAL_MS);
  }

  private async stepDown(): Promise<void> {
    this.isLeader = false;
    this.token = null;
    this.clearTimers();

    if (this.onLoseLeadership) {
      try {
        await this.onLoseLeadership();
      } catch (err) {
        this.logger.error('onLoseLeadership callback threw:', err);
      }
    }

    // Re-enter the acquisition loop to compete for leadership again
    if (!this.destroyed) {
      void this.tryAcquireLoop();
    }
  }

  private clearTimers(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
    if (this.acquireTimer) {
      clearTimeout(this.acquireTimer);
      this.acquireTimer = null;
    }
  }
}
