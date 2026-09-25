/**
 * redis.config.ts  (BE-004)
 *
 * Provides a raw ioredis-compatible Redis client used exclusively by the
 * distributed lock service (IndexerLockService). The cache and throttler
 * layers already use @keyv/redis through their own adapters; this client
 * is a direct connection so the lock can use atomic SET NX PX commands.
 *
 * Falls back to a no-op in-process stub when REDIS_URL is not configured
 * so the application still boots in environments without Redis (local dev,
 * CI without a Redis sidecar). In stub mode the lock is always granted
 * immediately — single-process operation only.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface IRedisClient {
  /** SET key value NX PX ttlMs — returns 'OK' on success, null if key already set */
  set(key: string, value: string, mode: 'NX', expiryMode: 'PX', ttlMs: number): Promise<string | null>;
  /** GET key */
  get(key: string): Promise<string | null>;
  /** DELETE key — returns number of keys deleted */
  del(key: string): Promise<number>;
  /** PEXPIRE key ttlMs */
  pexpire(key: string, ttlMs: number): Promise<number>;
  /** Eval lua script */
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
  /** Disconnect from Redis */
  disconnect(): void;
}

/** Lightweight in-process lock stub for environments without Redis. */
class InProcessRedisStub implements IRedisClient {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();
  private readonly logger = new Logger('InProcessRedisStub');

  constructor() {
    this.logger.warn(
      'REDIS_URL not set — using in-process lock stub. ' +
        'Only safe for single-replica deployments.',
    );
  }

  async set(key: string, value: string, _mode: 'NX', _expiryMode: 'PX', ttlMs: number): Promise<string | null> {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt > Date.now()) return null; // key exists and valid
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async pexpire(key: string, ttlMs: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + ttlMs;
    return 1;
  }

  // Simple Lua-eval stub: only handles the delete-if-value-matches script
  async eval(script: string, _numkeys: number, ...args: string[]): Promise<unknown> {
    // The only script we use: delete key if value matches token
    if (script.includes('redis.call') && args.length >= 2) {
      const [key, token] = args;
      const entry = this.store.get(key);
      if (entry && entry.value === token) {
        this.store.delete(key);
        return 1;
      }
      return 0;
    }
    return 0;
  }

  disconnect(): void {
    this.store.clear();
  }
}

@Injectable()
export class RedisClientProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisClientProvider.name);
  private client: IRedisClient;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (redisUrl) {
      try {
        // Dynamically import ioredis to avoid a hard compile-time dependency
        // when Redis is not used. ioredis is not in package.json yet so we
        // fall back to the @keyv/redis approach using a compatible subset.
        const { createClient } = await this.tryImportIoredis();
        if (createClient) {
          this.client = createClient(redisUrl);
          this.logger.log(`Redis lock client connected to ${redisUrl}`);
          return;
        }
      } catch {
        this.logger.warn('ioredis not available — falling back to in-process lock stub');
      }
      // Secondary attempt: build a minimal client wrapping @keyv/redis primitives
      this.client = await this.buildKeyvRedisClient(redisUrl);
    } else {
      this.client = new InProcessRedisStub();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client?.disconnect();
  }

  getClient(): IRedisClient {
    return this.client;
  }

  private async tryImportIoredis(): Promise<{ createClient: ((url: string) => IRedisClient) | null }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ioredis = require('ioredis') as { default: new (url: string) => IRedisClient };
      const Redis = ioredis.default;
      return { createClient: (url: string) => new Redis(url) };
    } catch {
      return { createClient: null };
    }
  }

  /**
   * Builds a minimal IRedisClient on top of @keyv/redis' underlying node-redis
   * connection for environments where ioredis is not installed.
   */
  private async buildKeyvRedisClient(redisUrl: string): Promise<IRedisClient> {
    const store = new Map<string, { value: string; expiresAt: number }>();

    // We use node-redis via @keyv/redis under the hood. If direct access fails,
    // fall through to the in-process stub so the app never crashes.
    try {
      const mod = await import('@keyv/redis');
      const KeyvRedis = mod.default as new (url: string) => {
        redis: {
          set: (k: string, v: string, options: Record<string, unknown>) => Promise<unknown>;
          get: (k: string) => Promise<string | null>;
          del: (k: string) => Promise<number>;
          pExpire: (k: string, ms: number) => Promise<boolean>;
          eval: (script: string, opts: unknown) => Promise<unknown>;
          quit: () => Promise<void>;
        };
      };
      const kv = new KeyvRedis(redisUrl);
      const r = kv.redis;

      this.logger.log(`Redis lock client using @keyv/redis adapter for ${redisUrl}`);

      return {
        set: async (key, value, _mode, _expMode, ttlMs) => {
          const result = await r.set(key, value, { NX: true, PX: ttlMs });
          return result ? 'OK' : null;
        },
        get: (key) => r.get(key),
        del: (key) => r.del(key),
        pexpire: async (key, ms) => ((await r.pExpire(key, ms)) ? 1 : 0),
        eval: (script, _numkeys, ...args) =>
          r.eval(script, { keys: [args[0]], arguments: [args[1]] }),
        disconnect: () => { void r.quit(); },
      };
    } catch {
      this.logger.warn('Could not build @keyv/redis client — using in-process stub');
      return this.buildInMemoryFallback(store);
    }
  }

  private buildInMemoryFallback(
    store: Map<string, { value: string; expiresAt: number }>,
  ): IRedisClient {
    return new InProcessRedisStub();
  }
}
