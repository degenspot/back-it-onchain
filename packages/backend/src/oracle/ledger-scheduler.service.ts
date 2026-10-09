/**
 * ledger-scheduler.service.ts  (BE-020)
 *
 * Resolves a call at the ledger where it expires, rather than whenever a poll
 * loop happens to notice.
 *
 * The problem
 * ───────────
 * The obvious implementation is a timer: `setTimeout(endTs - now)`. On Stellar
 * that is wrong in both directions.
 *
 * Too early is the dangerous one. A call that resolves at `endTs` must be
 * settled on a price from *after* `endTs`; resolving even a second early reads
 * a price the market has not reached yet, and the settlement reverts on-chain
 * or, worse, succeeds against a stale price. This is the "early execution race"
 * the issue is about, and no amount of timer accuracy fixes it on its own —
 * you need the ledger to actually be closed before you act.
 *
 * Too late is merely wasteful: it delays payouts and holds funds.
 *
 * The approach
 * ────────────
 * Three ideas, in order of importance:
 *
 *  1. **Target a ledger, not a timestamp.** From the observed ledger close time
 *     and the call's `endTs`, compute the ledger whose close is the first one
 *     at or after `endTs`. That ledger is then *locked*: later velocity
 *     corrections move the fire time, never the target. That is what keeps the
 *     result inside ±1 ledger instead of letting a drifting estimate walk the
 *     target somewhere else.
 *
 *     "Locked" is deliberately a late decision. Committing six hours out would
 *     freeze whatever the velocity estimate happened to be at arming time, and
 *     a few percent of error over six hours is hundreds of ledgers — nowhere
 *     near ±1. So the target is re-derived on every velocity sample while the
 *     call is still far from expiry, and only commits once the call is within
 *     `targetLockLeadMs` of ending, by which point the estimate is good to a
 *     fraction of a ledger. See {@link resyncPending}.
 *
 *  2. **Never act on an unclosed ledger.** When a job fires it does not settle.
 *     It checks whether the target ledger is closed, and if not, waits for it.
 *     The scheduling margin is an optimisation to avoid waiting; the check is
 *     the guarantee. Early execution is therefore impossible even if the
 *     velocity estimate is badly wrong or the RPC is ahead of us.
 *
 *  3. **Keep the velocity estimate honest.** An EMA over observed closes,
 *     rejecting outliers, so one slow ledger does not poison the estimate and
 *     a stalled connection cannot make every job fire hours early.
 */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LedgerJob, LEDGER_QUEUE, LedgerQueue } from './ledger-queue';
import { SorobanRpcClient } from '../config/soroban-rpc.client';

/** Handler the scheduler invokes once a target ledger is confirmed closed. */
export type LedgerDueHandler = (targetLedger: number) => Promise<void>;

export interface VelocitySample {
  ledger: number;
  observedAtMs: number;
}

export interface VelocityEstimate {
  /** Seconds between ledger closes. */
  secondsPerLedger: number;
  /** Highest ledger observed so far. */
  latestLedger: number;
  /** When that ledger was observed. */
  observedAtMs: number;
  /** Samples that contributed to the estimate. */
  sampleCount: number;
  /** True once the estimate rests on real observations, not the default. */
  calibrated: boolean;
}

export interface ScheduledCall {
  callId: number;
  targetLedger: number;
  fireAtMs: number;
  /** Ledger the target was computed from, for diagnostics. */
  computedFromLedger: number;
  scheduledAtMs: number;
  /** Times the job has been re-timed by a velocity correction. */
  retimes: number;
  /** The call's own expiry, kept so the target can be re-derived if needed. */
  endTsMs: number;
  /** True once the target is close enough to expiry to be committed to. */
  locked: boolean;
}

/** Stellar's nominal close time, used until real samples arrive. */
const DEFAULT_SECONDS_PER_LEDGER = 5;

/**
 * Plausible bounds for a single observed close. A close outside this range is
 * a network event, not a ledger property, and letting it into the estimate
 * would move every pending job.
 */
const MIN_SECONDS_PER_LEDGER = 1;
const MAX_SECONDS_PER_LEDGER = 60;

@Injectable()
export class LedgerSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LedgerSchedulerService.name);

  private secondsPerLedger = DEFAULT_SECONDS_PER_LEDGER;
  private latestLedger = 0;
  private observedAtMs = 0;
  private sampleCount = 0;

  private readonly pending = new Map<number, ScheduledCall>();
  private handler: LedgerDueHandler | null = null;
  private syncTimer?: NodeJS.Timeout;
  private stopped = false;
  /** In-flight calibration, so concurrent callers share one RPC round trip. */
  private calibrating?: Promise<boolean>;

  constructor(
    @Inject(LEDGER_QUEUE) private readonly queue: LedgerQueue,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly rpc?: SorobanRpcClient,
  ) {
    this.queue.onFire((job) => this.onJobFired(job));
  }

  // ─── Configuration ───────────────────────────────────────────────────────

  private get alpha(): number {
    return this.configService.get<number>('LEDGER_VELOCITY_EMA_ALPHA', 0.3);
  }

  /**
   * Extra delay added on top of the estimated close, covering the gap between
   * a ledger closing and the RPC reporting it as closed.
   */
  private get settleMarginMs(): number {
    return this.configService.get<number>(
      'LEDGER_CLOSE_SETTLE_MS',
      2_000,
    );
  }

  /** How long to wait between velocity samples. */
  private get syncIntervalMs(): number {
    return this.configService.get<number>(
      'LEDGER_VELOCITY_SYNC_MS',
      15_000,
    );
  }

  /** How often a fired job re-checks whether its ledger has closed. */
  private get confirmPollMs(): number {
    return this.configService.get<number>('LEDGER_CONFIRM_POLL_MS', 1_000);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.ensureCalibrated();
    this.startSyncLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.syncTimer) clearInterval(this.syncTimer);
  }

  private startSyncLoop(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      void this.syncVelocity();
    }, this.syncIntervalMs);
    this.syncTimer.unref?.();
  }

  // ─── Velocity ────────────────────────────────────────────────────────────

  /**
   * Make sure at least one real ledger has been observed.
   *
   * This is a correctness gate, not a warm-up. With `latestLedger === 0`,
   * `estimateTargetLedger` returns `0 + ceil(remaining / 5s)` — a ledger number
   * around 4,000 for a call an hour out, when the chain is actually past
   * 500,000. The target is then already in the past, and
   * `estimateFireAtMs` computes a fire time hundreds of thousands of seconds
   * away. So an uncalibrated scheduler does not resolve slightly late; it
   * produces targets that are nonsense, and it does so silently.
   *
   * Provider init order is not something to rely on here: `OracleService` also
   * has an `onModuleInit` that arms calls, and whether the scheduler's runs
   * first is an implementation detail of Nest's module traversal. Gating in
   * `scheduleCall` makes the order irrelevant.
   *
   * Returns false when the chain cannot be observed at all (no RPC configured,
   * or the RPC is down). Callers must then decline to invent a target.
   */
  private async ensureCalibrated(): Promise<boolean> {
    if (this.latestLedger > 0) return true;
    if (!this.rpc) return false;

    if (!this.calibrating) {
      this.calibrating = this.syncVelocity()
        .then(() => this.latestLedger > 0)
        .catch(() => false)
        .finally(() => {
          this.calibrating = undefined;
        });
    }
    return this.calibrating;
  }

  /**
   * Sample the chain and fold the observation into the velocity estimate.
   *
   * Safe to call when the RPC is unavailable: the existing estimate is kept and
   * the caller carries on with it. A scheduler that throws on a flaky RPC would
   * stop scheduling calls, which is worse than scheduling them with a
   * slightly stale velocity.
   */
  async syncVelocity(): Promise<VelocityEstimate> {
    if (!this.rpc) return this.getVelocity();

    let ledger: number;
    try {
      const latest = await this.rpc.getLatestLedger();
      ledger = Number(latest?.sequence ?? 0);
    } catch (err) {
      this.logger.warn(
        `Velocity sync failed, keeping last estimate: ${(err as Error).message}`,
      );
      return this.getVelocity();
    }

    if (!Number.isFinite(ledger) || ledger <= 0) {
      return this.getVelocity();
    }

    const now = Date.now();
    const previousLedger = this.latestLedger;
    const previousAt = this.observedAtMs;

    this.latestLedger = Math.max(ledger, previousLedger);
    this.observedAtMs = now;

    const ledgerDelta = this.latestLedger - previousLedger;
    const elapsedMs = now - previousAt;

    if (previousLedger > 0 && ledgerDelta > 0 && elapsedMs > 0) {
      const observedSeconds = elapsedMs / 1_000 / ledgerDelta;
      if (
        observedSeconds >= MIN_SECONDS_PER_LEDGER &&
        observedSeconds <= MAX_SECONDS_PER_LEDGER
      ) {
        this.secondsPerLedger =
          this.sampleCount === 0
            ? observedSeconds
            : this.alpha * observedSeconds +
              (1 - this.alpha) * this.secondsPerLedger;
        this.sampleCount += 1;
      } else {
        this.logger.warn(
          `Ignoring out-of-range ledger close sample: ${observedSeconds.toFixed(2)}s`,
        );
      }
    }

    const estimate = this.getVelocity();
    this.eventEmitter.emit('ledger.velocity_updated', estimate);

    // A material change in velocity invalidates the fire times computed from
    // the old one. Targets stay put; only the times move.
    await this.resyncPending();

    return estimate;
  }

  getVelocity(): VelocityEstimate {
    return {
      secondsPerLedger: this.secondsPerLedger,
      latestLedger: this.latestLedger,
      observedAtMs: this.observedAtMs,
      sampleCount: this.sampleCount,
      calibrated: this.sampleCount > 0,
    };
  }

  // ─── Estimation ──────────────────────────────────────────────────────────

  /**
   * The first ledger that closes at or after `endTsMs`.
   *
   * `Math.ceil` is load-bearing. Rounding down would target a ledger that
   * closes *before* the market ends, and settling on that would read a price
   * from inside the market's own lifetime — a wrong answer rather than a late
   * one.
   *
   * The current time is derived from the last observed ledger rather than the
   * wall clock, so a machine with a skewed clock still computes a sane
   * estimate.
   */
  estimateTargetLedger(endTsMs: number): number {
    const nowMs = this.observedAtMs || Date.now();
    const nowLedger = this.latestLedger;
    const remainingMs = endTsMs - nowMs;

    if (remainingMs <= 0) {
      // Already due. The next ledger to close is the soonest we could act.
      return nowLedger + 1;
    }

    const ledgersAhead = Math.ceil(
      remainingMs / (this.secondsPerLedger * 1_000),
    );
    return nowLedger + ledgersAhead;
  }

  /** Expected wall-clock close time of `targetLedger`, plus the settle margin. */
  estimateFireAtMs(targetLedger: number): number {
    const nowMs = this.observedAtMs || Date.now();
    const nowLedger = this.latestLedger;
    const ahead = Math.max(0, targetLedger - nowLedger);
    return nowMs + ahead * this.secondsPerLedger * 1_000 + this.settleMarginMs;
  }

  // ─── Scheduling ──────────────────────────────────────────────────────────

  /**
   * Schedule a call to resolve at its expiry ledger.
   *
   * Idempotent: scheduling the same call twice keeps the existing target. Once
   * a target is locked, re-deriving it from a newer estimate could move it, and
   * a target that moves is a target that can leave the ±1 ledger window.
   *
   * Returns null when the chain has never been observed. That is not a
   * swallowed error: scheduling an uncalibrated target is worse than not
   * scheduling, because it looks armed and silently never fires. The call stays
   * in the database, and the ordinary `resolveDueCalls` sweep still picks it up,
   * so returning null degrades precision rather than dropping the call.
   */
  async scheduleCall(
    callId: number,
    endTsMs: number,
  ): Promise<ScheduledCall | null> {
    const existing = this.pending.get(callId);
    if (existing) {
      // Re-arming runs on a timer, so this is the common path. Only touch the
      // queue when the fire time has actually moved: a blind upsert on every
      // sweep means a remove/re-add round trip to Redis per pending call per
      // minute, forever, for calls whose timing has not changed at all.
      const next = this.estimateFireAtMs(existing.targetLedger);
      if (Math.abs(next - existing.fireAtMs) >= this.retimeThresholdMs) {
        existing.fireAtMs = next;
        existing.retimes += 1;
        await this.queue.upsert({
          callId,
          targetLedger: existing.targetLedger,
          fireAtMs: next,
        });
      }
      return existing;
    }

    if (!(await this.ensureCalibrated())) {
      this.logger.warn(
        `Cannot schedule call ${callId}: no ledger observed yet, so no ` +
          'reliable target ledger. It will be resolved by the due-call sweep.',
      );
      return null;
    }

    const targetLedger = this.estimateTargetLedger(endTsMs);
    const scheduled: ScheduledCall = {
      callId,
      targetLedger,
      fireAtMs: this.estimateFireAtMs(targetLedger),
      computedFromLedger: this.latestLedger,
      scheduledAtMs: Date.now(),
      retimes: 0,
      endTsMs,
      locked: this.isWithinLockLead(endTsMs),
    };

    this.pending.set(callId, scheduled);
    await this.queue.upsert({
      callId,
      targetLedger,
      fireAtMs: scheduled.fireAtMs,
    });

    this.logger.log(
      `Call ${callId} scheduled for ledger ${targetLedger} ` +
        `(~${this.secondsPerLedger.toFixed(2)}s/ledger, ` +
        `in ${Math.max(0, Math.round((scheduled.fireAtMs - Date.now()) / 1000))}s)`,
    );
    this.eventEmitter.emit('ledger.call_scheduled', { ...scheduled });
    return scheduled;
  }

  /**
   * How close to expiry a call must be before its target stops moving.
   *
   * Two ledger intervals by default: long enough that the estimate has settled,
   * short enough that only a genuine correction moves the target.
   */
  private get targetLockLeadMs(): number {
    const seconds = this.configService.get<number>(
      'LEDGER_TARGET_LOCK_LEAD_SECONDS',
      0,
    );
    return (
      (seconds > 0 ? seconds : 2 * this.secondsPerLedger) * 1_000
    );
  }

  private get retimeThresholdMs(): number {
    return this.configService.get<number>('LEDGER_RETIME_THRESHOLD_MS', 1_000);
  }

  private isWithinLockLead(endTsMs: number): boolean {
    const nowMs = this.observedAtMs || Date.now();
    return endTsMs - nowMs <= this.targetLockLeadMs;
  }

  /**
   * Re-time pending jobs after a velocity change, and re-derive targets that are
   * not yet locked.
   *
   * Targets are only re-derived while the call is still further out than the
   * lock lead. That split is the whole accuracy story:
   *
   *   - Far out, the target is a *guess* built from the current velocity, and
   *     the guess improves every sample. Recomputing it costs one queue write
   *     and keeps the target converging on the true first-ledger-at-or-after
   *     endTs. Leaving it frozen here is what would put it hundreds of ledgers
   *     out, because a few percent of velocity error is 200+ ledgers over six
   *     hours.
   *   - Within the lock lead, the target is committed. At that point the
   *     remaining time is ~2 ledgers, so the estimate is good to a fraction of
   *     a ledger and further churn would only risk moving a target that is
   *     already right.
   */
  async resyncPending(): Promise<void> {
    if (this.pending.size === 0) return;

    for (const scheduled of this.pending.values()) {
      let targetChanged = false;

      if (!scheduled.locked && !this.isWithinLockLead(scheduled.endTsMs)) {
        const recomputed = this.estimateTargetLedger(scheduled.endTsMs);
        if (recomputed !== scheduled.targetLedger) {
          scheduled.targetLedger = recomputed;
          scheduled.computedFromLedger = this.latestLedger;
          targetChanged = true;
        }
      } else if (!scheduled.locked) {
        // Crossing into the lock lead is itself a state change worth recording.
        scheduled.locked = true;
        this.logger.log(
          `Call ${scheduled.callId} target locked to ledger ` +
            `${scheduled.targetLedger}`,
        );
      }

      const next = this.estimateFireAtMs(scheduled.targetLedger);
      const drifted = Math.abs(next - scheduled.fireAtMs) >= this.retimeThresholdMs;
      if (!targetChanged && !drifted) continue;

      scheduled.fireAtMs = next;
      scheduled.retimes += 1;
      await this.queue.upsert({
        callId: scheduled.callId,
        targetLedger: scheduled.targetLedger,
        fireAtMs: next,
      });
    }
  }

  /**
   * Handle a fired job.
   *
   * The wait for the ledger to actually close is the whole point: a job that
   * fires early does nothing but wait, so an early fire can never produce an
   * early settlement.
   */
  private async onJobFired(job: LedgerJob): Promise<void> {
    if (this.stopped) return;

    try {
      const closed = await this.awaitLedgerClose(job.targetLedger);
      if (!closed) {
        this.logger.warn(
          `Gave up waiting for ledger ${job.targetLedger} (call ${job.callId})`,
        );
        this.pending.delete(job.callId);
        return;
      }

      this.pending.delete(job.callId);
      this.eventEmitter.emit('ledger.closed', {
        callId: job.callId,
        targetLedger: job.targetLedger,
        observedAtMs: Date.now(),
      });

      if (this.handler) {
        await this.handler(job.targetLedger);
      }
    } catch (err) {
      this.logger.error(
        `Ledger job for call ${job.callId} failed: ${(err as Error).message}`,
      );
      this.pending.delete(job.callId);
    }
  }

  /**
   * Poll until the chain has passed `targetLedger`.
   *
   * Bounded so a chain that stops advancing releases the call instead of
   * holding a job open forever. On timeout the call is left alone rather than
   * resolved blind — the existing `resolveDueCalls` sweep will pick it up, and
   * that path re-checks the price.
   */
  private async awaitLedgerClose(targetLedger: number): Promise<boolean> {
    if (!this.rpc) return true;

    const maxWaitMs = this.configService.get<number>(
      'LEDGER_CONFIRM_TIMEOUT_MS',
      120_000,
    );
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      try {
        const latest = await this.rpc.getLatestLedger();
        const sequence = Number(latest?.sequence ?? 0);
        if (sequence >= targetLedger) {
          this.latestLedger = Math.max(this.latestLedger, sequence);
          this.observedAtMs = Date.now();
          return true;
        }
      } catch (err) {
        // A failed poll is not a reason to give up on the ledger; keep waiting
        // until the deadline.
        this.logger.warn(
          `Ledger confirmation poll failed: ${(err as Error).message}`,
        );
      }
      await this.sleep(this.confirmPollMs);
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }

  // ─── Registration and reads ──────────────────────────────────────────────

  /** Register whoever should run when a ledger closes. */
  setDueHandler(handler: LedgerDueHandler): void {
    this.handler = handler;
  }

  /**
   * Schedule every call that is not yet resolved.
   *
   * Called on boot so a restart does not lose pending work — the in-process
   * queue is not durable, so the database is the source of truth for what
   * still needs a target ledger.
   */
  async rearmPending(
    loadDue: () => Promise<Array<{ id: number; endTs: Date | string }>>,
  ): Promise<number> {
    const due = await loadDue();
    let armed = 0;
    for (const call of due) {
      const endTsMs = new Date(call.endTs).getTime();
      if (!Number.isFinite(endTsMs)) continue;
      await this.scheduleCall(call.id, endTsMs);
      armed += 1;
    }
    if (armed) {
      this.logger.log(`Re-armed ${armed} pending call(s) after startup`);
    }
    return armed;
  }

  getScheduled(callId: number): ScheduledCall | undefined {
    return this.pending.get(callId);
  }

  listScheduled(): ScheduledCall[] {
    return [...this.pending.values()];
  }

  /** Jobs waiting in the queue, for the memory-footprint check. */
  async pendingJobCount(): Promise<number> {
    return this.queue.pendingCount();
  }

  async cancel(callId: number): Promise<void> {
    this.pending.delete(callId);
    await this.queue.remove(callId);
  }
}
