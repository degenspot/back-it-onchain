import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import {
  DiskHealthIndicator,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { CacheHealthIndicator } from './indicators/cache.health-indicator';
import { RpcHealthIndicator } from './indicators/rpc.health-indicator';

type IndicatorStatus = 'up' | 'down';

interface IndicatorOutcome {
  key: string;
  critical: boolean;
  status: IndicatorStatus;
  detail: Record<string, unknown>;
}

export type OverallStatus = 'ok' | 'degraded' | 'error';

export interface ReadinessResponse {
  status: OverallStatus;
  info: Record<string, Record<string, unknown>>;
  details: Record<string, Record<string, unknown>>;
}

const MEMORY_HEAP_THRESHOLD_BYTES = 300 * 1024 * 1024; // 300MB
const DISK_THRESHOLD_PERCENT = 0.9; // fail if >90% of the volume is used

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly typeOrm: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly cache: CacheHealthIndicator,
    private readonly rpc: RpcHealthIndicator,
  ) {}

  /**
   * GET /health — liveness probe.
   *
   * Answers only "is this process alive and not wedged?" — no outbound
   * dependency (DB, cache, RPC) is checked here. A container orchestrator
   * uses this to decide whether to restart the process; it must stay fast
   * and independent of external services staying up.
   */
  @Get()
  async liveness() {
    const result = await this.memory.checkHeap(
      'memory_heap',
      MEMORY_HEAP_THRESHOLD_BYTES,
    );
    return { status: 'ok', info: result };
  }

  /**
   * GET /health/ready — readiness probe.
   *
   * Checks every external dependency the app needs to correctly serve
   * traffic: PostgreSQL (critical), cache, Base RPC, Soroban RPC, and disk
   * (all degradable). PostgreSQL failing always reports `error` (503) since
   * nothing in the app works without it. Non-critical dependencies may fail
   * up to HEALTH_DEGRADED_THRESHOLD at a time and the endpoint still
   * reports `degraded` with a 200 — enough dependencies are healthy to
   * keep serving most traffic, but an operator should be paged.
   */
  @Get('ready')
  async readiness(@Res({ passthrough: true }) res?: Response): Promise<ReadinessResponse> {
    const threshold = this.configService.get<number>(
      'HEALTH_DEGRADED_THRESHOLD',
      1,
    );

    const outcomes = await Promise.all([
      this.run('database', true, () => this.typeOrm.pingCheck('database')),
      this.run('cache', false, () => this.cache.pingCheck('cache')),
      this.run('rpc_base', false, () => this.rpc.checkBase('rpc_base')),
      this.run('rpc_soroban', false, () => this.rpc.checkSoroban('rpc_soroban')),
      this.run('disk', false, () =>
        this.disk.checkStorage('disk', {
          thresholdPercent: DISK_THRESHOLD_PERCENT,
          path: '/',
        }),
      ),
    ]);

    const info: Record<string, Record<string, unknown>> = {};
    const details: Record<string, Record<string, unknown>> = {};
    let criticalDown = 0;
    let nonCriticalDown = 0;

    for (const outcome of outcomes) {
      details[outcome.key] = { status: outcome.status, ...outcome.detail };
      if (outcome.status === 'up') {
        info[outcome.key] = details[outcome.key];
      } else if (outcome.critical) {
        criticalDown++;
      } else {
        nonCriticalDown++;
      }
    }

    let status: OverallStatus = 'ok';
    if (criticalDown > 0 || nonCriticalDown > threshold) {
      status = 'error';
    } else if (nonCriticalDown > 0) {
      status = 'degraded';
    }

    if (status === 'error' && res) {
      res.status(503);
    }

    return { status, info, details };
  }

  private async run(
    key: string,
    critical: boolean,
    check: () => Promise<Record<string, Record<string, unknown>>>,
  ): Promise<IndicatorOutcome> {
    try {
      const result = await check();
      const detail = result[key] as Record<string, unknown>;
      const status = (detail?.status as IndicatorStatus) ?? 'up';
      return { key, critical, status, detail };
    } catch (err) {
      return {
        key,
        critical,
        status: 'down',
        detail: { message: (err as Error).message },
      };
    }
  }
}
