/**
 * price-staleness.service.ts  (BE-018)
 *
 * Decides whether a price is trustworthy enough to settle a market on.
 *
 * Why this is a separate concern from fetching the price
 * ─────────────────────────────────────────────────────────
 * `fetchPrice` answers "what is the price right now". It returns a number, and
 * a number is all a caller usually looks at. But a price of 42,100 with a feed
 * that last ticked 40 minutes ago is not a price — it is a stale value that
 * happens to be well-formed, and settling on it moves real money to the wrong
 * side. Worse, a thin pool can report a live-looking price all day: the feed
 * is technically fresh and technically accurate, and still untradeable.
 *
 * The rules here come from the issue and are deliberately blunt, because the
 * cost of a false negative (a correctly halted call that an admin unfreezes)
 * is a delay, while the cost of a false positive (settling on a stale price)
 * is money that cannot be recovered:
 *
 *   - the feed's own timestamp is older than 10 minutes, or
 *   - 24h volume is below $1,000 (too thin to exit a position)
 *   → RESOLUTION_HALTED
 *
 * Both checks fail *closed*. A missing timestamp or volume is treated as a
 * violation, not as "no data, so it's fine": an absent field is a feed that
 * stopped reporting, which is exactly the case the freeze exists to catch.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Thrown when a price is not fresh or liquid enough to settle on. */
export class StalePriceError extends Error {
  constructor(
    public readonly reason: StalePriceReason,
    message: string,
    /** Seconds past the limit; omitted for a volume violation. */
    public readonly ageSeconds?: number,
  ) {
    super(message);
    this.name = 'StalePriceError';
  }
}

export type StalePriceReason = 'stale-timestamp' | 'low-volume';

/** The minimum a price must carry before it can settle a market. */
export interface PriceFreshness {
  price: number;
  /**
   * Feed's own observation time, in ms. Distinct from `fetchedAt`: a feed can
   * be polled constantly and still be quoting an old tick.
   */
  timestamp?: number;
  /**
   * Fallback freshness evidence for feeds that publish no observation time.
   *
   * DexScreener's token-pairs endpoint reports the *current state* of a pair
   * but no "last traded at", so polling it every second will happily return the
   * same dead price all day. `changedAtMs` is when this service last saw the
   * quoted value *change*; if that is older than the limit, the feed is stale
   * however often it is polled.
   *
   * Only the caller that can observe price change should set this. When both
   * `timestamp` and `changedAtMs` are absent, freshness is unverifiable and
   * the check fails closed.
   */
  changedAtMs?: number;
  /** 24-hour quote volume in USD. */
  volume24h?: number;
  /** Which feed produced this price, for the alert context. */
  source?: string;
}

/** One violation, shaped for storage and for the admin alert payload. */
export interface StalenessViolation {
  reason: StalePriceReason;
  message: string;
  /** Feed observation time in ms, when the violation is a stale timestamp. */
  observedAt?: number;
  /** Seconds the feed was behind the resolution time. */
  ageSeconds?: number;
  /** Observed 24h volume in USD, when the violation is low volume. */
  volume24h?: number;
  volumeThreshold: number;
  staleThresholdSeconds: number;
  source?: string;
}

export interface StalenessVerdict {
  fresh: boolean;
  violations: StalenessViolation[];
}

@Injectable()
export class PriceStalenessService {
  private readonly maxAgeSeconds: number;
  private readonly minVolumeUsd: number;
  /** Cap on tracked tokens, so a long-running oracle cannot leak memory. */
  private readonly maxTrackedTokens = 10_000;
  private readonly lastPriceChange = new Map<
    string,
    { price: number; changedAt: number }
  >();

  constructor(configService: ConfigService) {
    this.maxAgeSeconds = Number(
      configService.get<number>('ORACLE_MAX_PRICE_AGE_SECONDS', 600),
    );
    this.minVolumeUsd = Number(
      configService.get<number>('ORACLE_MIN_24H_VOLUME_USD', 1_000),
    );
  }

  /** Threshold currently in force, so the alert can state it. */
  getThresholds(): { maxAgeSeconds: number; minVolumeUsd: number } {
    return {
      maxAgeSeconds: this.maxAgeSeconds,
      minVolumeUsd: this.minVolumeUsd,
    };
  }

  /**
   * Inspect a price and return every reason it must not be settled on.
   *
   * Returns all violations rather than the first: an admin unfreezing a call
   * needs to know about *all* the reasons it was frozen, or they will unfreeze
   * it into the same wall.
   */
  evaluate(
    quote: PriceFreshness,
    /** Unix ms the market resolves at — normally the call's `endTs`. */
    resolutionAtMs: number,
  ): StalenessVerdict {
    const violations: StalenessViolation[] = [];
    const resolutionAtSeconds = Math.floor(resolutionAtMs / 1000);

    // ── Freshness ──────────────────────────────────────────────────────────
    // Evidence is used in order of authority: the feed's own timestamp, then
    // locally-observed price change. A feed that reports neither is
    // unverifiable, and unverifiable is treated as stale — a feed that stopped
    // reporting must not be able to settle markets indefinitely.
    const observedAt = quote.timestamp ?? quote.changedAtMs;
    if (observedAt === undefined || !Number.isFinite(observedAt)) {
      violations.push({
        reason: 'stale-timestamp',
        message:
          `price feed (${quote.source ?? 'unknown'}) reports neither an ` +
          'observation time nor an observable price change; freshness cannot ' +
          'be verified',
        volumeThreshold: this.minVolumeUsd,
        staleThresholdSeconds: this.maxAgeSeconds,
        source: quote.source,
      });
    } else {
      const ageSeconds = resolutionAtSeconds - Math.floor(observedAt / 1000);
      if (ageSeconds > this.maxAgeSeconds) {
        violations.push({
          reason: 'stale-timestamp',
          message: `price feed is ${ageSeconds}s old, over the ${this.maxAgeSeconds}s limit`,
          observedAt,
          ageSeconds,
          volumeThreshold: this.minVolumeUsd,
          staleThresholdSeconds: this.maxAgeSeconds,
          source: quote.source,
        });
      }
    }

    // ── Liquidity ──────────────────────────────────────────────────────────
    // Same reasoning: absent volume is not "thin", it is unknown, and a pool
    // with unknown depth cannot be exited.
    if (quote.volume24h === undefined || !Number.isFinite(quote.volume24h)) {
      violations.push({
        reason: 'low-volume',
        message: 'price feed reported no 24h volume; depth cannot be verified',
        volumeThreshold: this.minVolumeUsd,
        staleThresholdSeconds: this.maxAgeSeconds,
        source: quote.source,
      });
    } else if (quote.volume24h < this.minVolumeUsd) {
      violations.push({
        reason: 'low-volume',
        message:
          `24h volume $${quote.volume24h.toFixed(2)} is below the ` +
          `$${this.minVolumeUsd} minimum`,
        volume24h: quote.volume24h,
        volumeThreshold: this.minVolumeUsd,
        staleThresholdSeconds: this.maxAgeSeconds,
        source: quote.source,
      });
    }

    return { fresh: violations.length === 0, violations };
  }

  /**
   * Evaluate and throw if the price must not be used.
   *
   * This is the guard the resolution path calls. Throwing rather than returning
   * a boolean keeps a future caller from forgetting to check.
   */
  assertSettleable(quote: PriceFreshness, resolutionAtMs: number): void {
    const { fresh, violations } = this.evaluate(quote, resolutionAtMs);
    if (fresh) return;

    const first = violations[0];
    throw new StalePriceError(
      first.reason,
      `refusing to settle on an untrustworthy price: ${violations
        .map((v) => v.message)
        .join('; ')}`,
      first.ageSeconds,
    );
  }

  // ─── Local price-change observation ──────────────────────────────────────

  /**
   * Record the last time a token's quoted price actually changed, and return
   * it as freshness evidence.
   *
   * This exists because DexScreener's token-pairs endpoint has no
   * "last traded at" field. Without it, the only way to tell a live market from
   * a dead one is 24h volume — which GeckoTerminal's fallback endpoint does not
   * report at all. Tracking price change gives both feeds a usable freshness
   * signal.
   *
   * The first observation of a token records "changed now", so a token seen for
   * the first time is not instantly considered stale; it becomes stale only
   * after sitting unchanged past the limit.
   *
   * Bounded on purpose: entries are pruned once they are older than the
   * staleness window, because a token that has not been quoted in that long
   * cannot be settled anyway. Without this the map would grow with every token
   * the oracle has ever seen.
   */
  observePriceChange(tokenAddress: string, price: number): number {
    const now = Date.now();
    const previous = this.lastPriceChange.get(tokenAddress);

    if (previous === undefined || previous.price !== price) {
      this.lastPriceChange.set(tokenAddress, { price, changedAt: now });
      this.prune(now);
      return now;
    }
    return previous.changedAt;
  }

  /** Forget a token's observation, e.g. after a call is unfrozen and re-resolved. */
  forgetToken(tokenAddress: string): void {
    this.lastPriceChange.delete(tokenAddress);
  }

  private prune(now: number): void {
    if (this.lastPriceChange.size < this.maxTrackedTokens) return;
    const cutoff = now - this.maxAgeSeconds * 1_000;
    for (const [token, entry] of this.lastPriceChange) {
      if (entry.changedAt < cutoff) this.lastPriceChange.delete(token);
    }
  }
}
