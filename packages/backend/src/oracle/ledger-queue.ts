/**
 * ledger-queue.ts  (BE-020)
 *
 * The delivery mechanism for ledger-expiry jobs, behind a narrow interface.
 *
 * The scheduler's correctness lives in `LedgerSchedulerService` — which ledger
 * to target and when to fire — and none of it should depend on BullMQ. Keeping
 * the queue behind a port means the timing logic can be exercised without a
 * Redis, and a deployment without Redis still gets precise scheduling from the
 * in-process adapter instead of silently falling back to a poll loop.
 *
 * Redis footprint
 * ───────────────
 * Two choices do most of the work here, and both are easy to get wrong:
 *
 *   - `removeOnComplete` / `removeOnFail` are set on every job. Without them
 *     BullMQ keeps every job it has ever run, and a scheduler that fires
 *     continuously is one of the fastest ways to grow an unbounded Redis key
 *     space.
 *   - the job id is derived from the call id, so re-scheduling a call replaces
 *     its job instead of adding a second one. A drifting velocity estimate
 *     causes frequent re-scheduling, and without a stable id that would
 *     accumulate duplicate jobs for the same call.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const LEDGER_QUEUE = 'LEDGER_QUEUE';

export interface LedgerJob {
  callId: number;
  /** Locked at scheduling time; never recomputed. */
  targetLedger: number;
  /** Wall-clock ms at which the job should run. */
  fireAtMs: number;
}

export interface LedgerQueue {
  /** Insert or replace the job for a call. */
  upsert(job: LedgerJob): Promise<void>;
  /** Drop a call's job, e.g. once it has been resolved. */
  remove(callId: number): Promise<void>;
  /** Register the fire handler. */
  onFire(handler: (job: LedgerJob) => Promise<void>): void;
  /** Jobs currently waiting. Used for the memory-footprint check. */
  pendingCount(): Promise<number>;
  close(): Promise<void>;
}

/** Stable job id, so re-scheduling replaces rather than duplicates. */
export function ledgerJobId(callId: number): string {
  return `call-${callId}`;
}

// ─── BullMQ adapter ────────────────────────────────────────────────────────

/**
 * Durable queue backed by BullMQ.
 *
 * Used whenever REDIS_URL is set, which is any real deployment: jobs survive a
 * restart, and several replicas can share one queue so two of them never
 * resolve the same call.
 */
@Injectable()
export class BullMqLedgerQueue implements LedgerQueue, OnModuleDestroy {
  private readonly logger = new Logger(BullMqLedgerQueue.name);
  private queue: unknown;
  private worker: unknown;

  constructor(private readonly configService: ConfigService) {
    // Required rather than imported so a deployment on the in-process path never
    // pays BullMQ's load cost, and so a broken install fails only where Redis is
    // actually configured. Typed through `typeof import` so the queue and worker
    // stay fully type-checked despite the runtime require.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Queue, Worker } = require('bullmq') as typeof import('bullmq');
    const connection = this.buildConnection();

    this.queue = new Queue('ledger-expiry', {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
      },
    });

    this.worker = new Worker(
      'ledger-expiry',
      // Must return the handler's promise. A callback that fires the handler
      // and returns undefined tells BullMQ the job finished the moment it was
      // picked up, so the job is marked complete while the ledger wait is still
      // running, a rejection here becomes an unhandled rejection, and BullMQ's
      // retry/backoff machinery never sees the failure at all.
      async (job: { data: LedgerJob }) => {
        await this.handler?.(job.data);
      },
      { connection },
    );

    this.logger.log('Ledger expiry queue connected to Redis (BullMQ)');
  }

  private handler?: (job: LedgerJob) => Promise<void>;

  private buildConnection(): Record<string, unknown> {
    const url = new URL(
      this.configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
    );
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: url.password } : {}),
      ...(url.username ? { username: url.username } : {}),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  }

  async upsert(job: LedgerJob): Promise<void> {
    const delay = Math.max(0, job.fireAtMs - Date.now());
    const q = this.queue as {
      add: (
        name: string,
        data: LedgerJob,
        opts: Record<string, unknown>,
      ) => Promise<unknown>;
      remove: (id: string) => Promise<void>;
    };

    // A delayed job cannot be re-timed in place, so the old one goes first.
    // Removing by the stable id keeps this to one job per call.
    await q.remove(ledgerJobId(job.callId)).catch(() => undefined);
    await q.add('expire', job, {
      jobId: ledgerJobId(job.callId),
      delay,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async remove(callId: number): Promise<void> {
    const q = this.queue as { remove: (id: string) => Promise<void> };
    await q.remove(ledgerJobId(callId)).catch(() => undefined);
  }

  onFire(handler: (job: LedgerJob) => Promise<void>): void {
    this.handler = handler;
  }

  async pendingCount(): Promise<number> {
    const q = this.queue as {
      getJobCounts: (...states: string[]) => Promise<Record<string, number>>;
    };
    const counts = await q.getJobCounts('waiting', 'delayed', 'active');
    return (
      (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0)
    );
  }

  async close(): Promise<void> {
    await (this.worker as { close?: () => Promise<void> })?.close?.();
    await (this.queue as { close?: () => Promise<void> })?.close?.();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}

// ─── In-process adapter ────────────────────────────────────────────────────

/**
 * In-process queue for single-replica deployments and environments without
 * Redis.
 *
 * Precision is the same as the BullMQ path — the scheduler decides *when*, this
 * only decides *who holds the timer* — so a deployment without Redis does not
 * silently lose the ±1 ledger guarantee. It does lose durability: a restart
 * drops pending jobs, which is why the scheduler re-arms from the database on
 * boot rather than trusting this queue to remember.
 */
@Injectable()
export class InProcessLedgerQueue implements LedgerQueue, OnModuleDestroy {
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private readonly jobs = new Map<number, LedgerJob>();
  private handler?: (job: LedgerJob) => Promise<void>;

  async upsert(job: LedgerJob): Promise<void> {
    this.clearTimer(job.callId);
    this.jobs.set(job.callId, job);

    const delay = Math.max(0, job.fireAtMs - Date.now());
    const timer = setTimeout(() => {
      // Drop bookkeeping before awaiting, so a slow handler cannot leave a
      // stale entry behind and inflate the pending count.
      this.timers.delete(job.callId);
      this.jobs.delete(job.callId);
      // Caught explicitly: `void` on a rejecting promise is an unhandled
      // rejection, which in Node 15+ terminates the process. A failed
      // resolution must not be able to take the whole backend down.
      this.handler?.(job).catch((err: unknown) => {
        console.error(
          `[ledger-queue] handler failed for call ${job.callId}:`,
          (err as Error)?.message ?? err,
        );
      });
    }, delay);
    // Do not hold the process open purely for a scheduled job.
    timer.unref?.();
    this.timers.set(job.callId, timer);
  }

  async remove(callId: number): Promise<void> {
    this.clearTimer(callId);
    this.jobs.delete(callId);
  }

  onFire(handler: (job: LedgerJob) => Promise<void>): void {
    this.handler = handler;
  }

  async pendingCount(): Promise<number> {
    return this.jobs.size;
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.jobs.clear();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private clearTimer(callId: number): void {
    const existing = this.timers.get(callId);
    if (existing) clearTimeout(existing);
    this.timers.delete(callId);
  }
}
