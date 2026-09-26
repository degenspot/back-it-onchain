/**
 * price-staleness.service.spec.ts  (BE-018)
 *
 * The freeze is the only thing standing between a dead or thin market and a
 * signed, irreversible settlement, so these tests pin down the boundaries and,
 * more importantly, the failure modes: what happens when the feed reports
 * nothing at all.
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  PriceStalenessService,
  StalePriceError,
} from './price-staleness.service';

const MAX_AGE = 600; // 10 minutes
const MIN_VOLUME = 1_000;

const RESOLUTION_AT_MS = 1_700_000_000_000;
const RESOLUTION_AT_SEC = RESOLUTION_AT_MS / 1000;

function makeService(
  overrides: Record<string, unknown> = {},
): PriceStalenessService {
  const config = {
    ORACLE_MAX_PRICE_AGE_SECONDS: MAX_AGE,
    ORACLE_MIN_24H_VOLUME_USD: MIN_VOLUME,
    ...overrides,
  };
  return new PriceStalenessService({
    get: (key: string, fallback?: unknown) => config[key] ?? fallback,
  } as unknown as ConfigService);
}

/** A quote that passes both checks, so each test can break exactly one thing. */
function goodQuote(overrides = {}) {
  return {
    price: 42_100,
    timestamp: RESOLUTION_AT_MS - 1_000,
    volume24h: 5_000_000,
    source: 'dexscreener',
    ...overrides,
  };
}

describe('PriceStalenessService (BE-018)', () => {
  let service: PriceStalenessService;

  beforeEach(() => {
    service = makeService();
  });

  describe('module wiring', () => {
    it('is injectable', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          PriceStalenessService,
          {
            provide: ConfigService,
            useValue: {
              get: (key: string, fallback?: unknown) =>
                ({
                  ORACLE_MAX_PRICE_AGE_SECONDS: MAX_AGE,
                  ORACLE_MIN_24H_VOLUME_USD: MIN_VOLUME,
                })[key] ?? fallback,
            },
          },
        ],
      }).compile();

      expect(moduleRef.get(PriceStalenessService)).toBeInstanceOf(
        PriceStalenessService,
      );
    });

    it('reports the thresholds in force', () => {
      expect(service.getThresholds()).toEqual({
        maxAgeSeconds: MAX_AGE,
        minVolumeUsd: MIN_VOLUME,
      });
    });

    it('honours configured thresholds over the defaults', () => {
      const strict = makeService({
        ORACLE_MAX_PRICE_AGE_SECONDS: 60,
        ORACLE_MIN_24H_VOLUME_USD: 50_000,
      });
      expect(strict.getThresholds()).toEqual({
        maxAgeSeconds: 60,
        minVolumeUsd: 50_000,
      });
    });
  });

  describe('a healthy price', () => {
    it('is fresh', () => {
      const verdict = service.evaluate(goodQuote(), RESOLUTION_AT_MS);
      expect(verdict.fresh).toBe(true);
      expect(verdict.violations).toEqual([]);
    });

    it('is fresh at exactly the age limit, since the limit is "older than"', () => {
      const quote = goodQuote({
        timestamp: (RESOLUTION_AT_SEC - MAX_AGE) * 1_000,
      });
      expect(service.evaluate(quote, RESOLUTION_AT_MS).fresh).toBe(true);
    });

    it('is fresh at exactly the volume limit, since the limit is "below"', () => {
      const quote = goodQuote({ volume24h: MIN_VOLUME });
      expect(service.evaluate(quote, RESOLUTION_AT_MS).fresh).toBe(true);
    });
  });

  describe('staleness', () => {
    it('freezes a price one second past the limit', () => {
      const quote = goodQuote({
        timestamp: (RESOLUTION_AT_SEC - MAX_AGE - 1) * 1_000,
      });
      const verdict = service.evaluate(quote, RESOLUTION_AT_MS);

      expect(verdict.fresh).toBe(false);
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0].reason).toBe('stale-timestamp');
      expect(verdict.violations[0].ageSeconds).toBe(MAX_AGE + 1);
    });

    it('freezes a price that has not moved in 40 minutes', () => {
      const quote = goodQuote({
        timestamp: (RESOLUTION_AT_SEC - 2_400) * 1_000,
      });
      const verdict = service.evaluate(quote, RESOLUTION_AT_MS);

      expect(verdict.fresh).toBe(false);
      expect(verdict.violations[0].message).toContain('2400s old');
    });

    it('freezes when the feed reports no timestamp at all', () => {
      const { timestamp, ...noTimestamp } = goodQuote();
      const verdict = service.evaluate(noTimestamp, RESOLUTION_AT_MS);

      expect(verdict.fresh).toBe(false);
      expect(verdict.violations[0].reason).toBe('stale-timestamp');
      expect(verdict.violations[0].message).toContain(
        'neither an observation time',
      );
    });

    it('freezes when the feed reports a non-finite timestamp', () => {
      for (const bad of [NaN, Infinity, -Infinity]) {
        const verdict = service.evaluate(
          goodQuote({ timestamp: bad }),
          RESOLUTION_AT_MS,
        );
        expect(verdict.fresh).toBe(false);
        expect(verdict.violations[0].reason).toBe('stale-timestamp');
      }
    });

    it('carries the source into the violation, for the admin alert', () => {
      const verdict = service.evaluate(
        goodQuote({
          source: 'geckoterminal',
          timestamp: (RESOLUTION_AT_SEC - 7_200) * 1_000,
        }),
        RESOLUTION_AT_MS,
      );
      expect(verdict.violations[0].source).toBe('geckoterminal');
    });
  });

  describe('liquidity', () => {
    it('freezes a market trading below the minimum', () => {
      const verdict = service.evaluate(
        goodQuote({ volume24h: 999.99 }),
        RESOLUTION_AT_MS,
      );

      expect(verdict.fresh).toBe(false);
      expect(verdict.violations[0].reason).toBe('low-volume');
      expect(verdict.violations[0].volume24h).toBe(999.99);
    });

    it('freezes a market that reports no volume, rather than assuming it is fine', () => {
      const { volume24h, ...noVolume } = goodQuote();
      const verdict = service.evaluate(noVolume, RESOLUTION_AT_MS);

      expect(verdict.fresh).toBe(false);
      expect(verdict.violations[0].reason).toBe('low-volume');
      expect(verdict.violations[0].message).toContain('no 24h volume');
    });

    it('freezes a market reporting NaN volume', () => {
      const verdict = service.evaluate(
        goodQuote({ volume24h: NaN }),
        RESOLUTION_AT_MS,
      );
      expect(verdict.fresh).toBe(false);
      expect(verdict.violations[0].reason).toBe('low-volume');
    });
  });

  describe('reporting every reason', () => {
    it('returns both violations so an admin sees the whole picture', () => {
      const verdict = service.evaluate(
        {
          price: 1,
          timestamp: (RESOLUTION_AT_SEC - 7_200) * 1_000,
          volume24h: 12,
          source: 'dexscreener',
        },
        RESOLUTION_AT_MS,
      );

      expect(verdict.fresh).toBe(false);
      expect(verdict.violations.map((v) => v.reason)).toEqual([
        'stale-timestamp',
        'low-volume',
      ]);
    });

    it('states the thresholds that were applied on every violation', () => {
      const verdict = service.evaluate(
        { price: 1, source: 'dexscreener' },
        RESOLUTION_AT_MS,
      );

      for (const violation of verdict.violations) {
        expect(violation.staleThresholdSeconds).toBe(MAX_AGE);
        expect(violation.volumeThreshold).toBe(MIN_VOLUME);
      }
    });
  });

  describe('assertSettleable', () => {
    it('passes a healthy price through', () => {
      expect(() =>
        service.assertSettleable(goodQuote(), RESOLUTION_AT_MS),
      ).not.toThrow();
    });

    it('throws a StalePriceError carrying the reason and age', () => {
      const quote = goodQuote({
        timestamp: (RESOLUTION_AT_SEC - 900) * 1_000,
      });

      expect(() => service.assertSettleable(quote, RESOLUTION_AT_MS)).toThrow(
        StalePriceError,
      );
      try {
        service.assertSettleable(quote, RESOLUTION_AT_MS);
      } catch (err) {
        expect((err as StalePriceError).reason).toBe('stale-timestamp');
        expect((err as StalePriceError).ageSeconds).toBe(900);
      }
    });

    it('joins every reason into the message, not just the first', () => {
      try {
        service.assertSettleable(
          { price: 1, source: 'geckoterminal' },
          RESOLUTION_AT_MS,
        );
        throw new Error('expected a StalePriceError');
      } catch (err) {
        const message = (err as StalePriceError).message;
        expect(message).toContain('neither an observation time');
        expect(message).toContain('no 24h volume');
      }
    });
  });

  describe('price-change tracking', () => {
    // DexScreener's token-pairs endpoint has no "last traded at" field, so
    // polling it tells you nothing about whether the market is alive. These
    // cover the local substitute: if the quoted value has not moved, the feed
    // is reporting a dead price however often it is polled.

    it('treats a first sighting as freshly changed', () => {
      const changedAt = service.observePriceChange('0xtoken', 42_100);
      expect(changedAt).toBeCloseTo(Date.now(), -3);
    });

    it('keeps the original change time when the price is unchanged', () => {
      const first = service.observePriceChange('0xtoken', 42_100);
      const second = service.observePriceChange('0xtoken', 42_100);
      expect(second).toBe(first);
    });

    it('resets the change time when the price moves', () => {
      const base = 1_700_000_000_000;
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(base);
      const first = service.observePriceChange('0xtoken', 42_100);
      nowSpy.mockReturnValue(base + 5_000);
      expect(service.observePriceChange('0xtoken', 42_101)).toBe(base + 5_000);
      expect(first).toBe(base);
      nowSpy.mockRestore();
    });

    it('tracks each token independently', () => {
      const a = service.observePriceChange('0xa', 1);
      const b = service.observePriceChange('0xb', 1);
      expect(service.observePriceChange('0xa', 1)).toBe(a);
      expect(service.observePriceChange('0xb', 1)).toBe(b);
    });

    it('makes a feed with no timestamp settleable via price change', () => {
      const { timestamp, ...noTimestamp } = goodQuote();
      expect(service.evaluate(noTimestamp, RESOLUTION_AT_MS).fresh).toBe(false);

      const changedAt = service.observePriceChange('0xtoken', 42_100);
      const verdict = service.evaluate(
        { ...noTimestamp, changedAtMs: changedAt },
        RESOLUTION_AT_MS,
      );
      expect(verdict.fresh).toBe(true);
    });

    it('re-freezes a token whose price has sat still past the limit', () => {
      const first = service.observePriceChange('0xtoken', 42_100);

      // Same price, but the market resolved long after the last change.
      const laterResolution = first + (MAX_AGE + 60) * 1_000;
      const { timestamp, ...noTimestamp } = goodQuote();
      const verdict = service.evaluate(
        { ...noTimestamp, changedAtMs: first },
        laterResolution,
      );

      expect(verdict.fresh).toBe(false);
      expect(verdict.violations[0].reason).toBe('stale-timestamp');
    });

    it('prefers the feed timestamp over local price-change evidence', () => {
      // A feed that says when it ticked is more authoritative than our own
      // observation, so a stale feed timestamp must not be rescued by a recent
      // local change.
      const quote = goodQuote({
        timestamp: (RESOLUTION_AT_SEC - 7_200) * 1_000,
        changedAtMs: RESOLUTION_AT_MS - 1_000,
      });
      expect(service.evaluate(quote, RESOLUTION_AT_MS).fresh).toBe(false);
    });

    it('forgets a token on request', () => {
      const base = 1_700_000_000_000;
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(base);
      const first = service.observePriceChange('0xtoken', 42_100);

      service.forgetToken('0xtoken');
      nowSpy.mockReturnValue(base + 5_000);
      expect(service.observePriceChange('0xtoken', 42_100)).toBe(base + 5_000);
      expect(first).toBe(base);

      nowSpy.mockRestore();
    });

    it('ignores a forget for a token it never saw', () => {
      expect(() => service.forgetToken('0xunknown')).not.toThrow();
    });

    it('bounds its memory to the configured cap', () => {
      const tracker = service as unknown as { lastPriceChange: Map<string, unknown> };
      // Fill past the cap with entries already older than the staleness window.
      const old = Date.now() - (MAX_AGE + 1) * 1_000;
      for (let i = 0; i < 10_100; i++) {
        tracker.lastPriceChange.set(`0xold${i}`, { price: 1, changedAt: old });
      }
      expect(tracker.lastPriceChange.size).toBeGreaterThan(10_000);

      // Observing a new token triggers the prune.
      service.observePriceChange('0xnew', 1);
      expect(tracker.lastPriceChange.size).toBeLessThan(10_000);
    });
  });
});
