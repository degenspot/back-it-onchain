import { describe, it, expect } from 'vitest';
import {
  breakEvenProbability,
  computeParimutuelOdds,
  computePayout,
  defaultScenarios,
  explorerTxUrl,
  projectPosition,
  projectScenarios,
  type PoolScenario,
} from './payout-utils';

describe('payout-utils', () => {
  describe('computePayout', () => {
    it('gives the full pool to a sole winner (minus fee)', () => {
      const p = computePayout({
        userStake: 100,
        winningPoolTotal: 100,
        losingPoolTotal: 100,
        feeBps: 200,
      });
      // gross = (100/100) * 200 = 200; fee = 2% = 4; net = 196
      expect(p.gross).toBe(200);
      expect(p.fee).toBe(4);
      expect(p.net).toBe(196);
      expect(p.profit).toBe(96);
      expect(p.share).toBe(1);
    });

    it('splits proportionally among winners', () => {
      const p = computePayout({
        userStake: 25,
        winningPoolTotal: 100,
        losingPoolTotal: 300,
        feeBps: 0,
      });
      // share = 0.25; totalPool = 400; gross = 100
      expect(p.share).toBe(0.25);
      expect(p.gross).toBe(100);
      expect(p.net).toBe(100);
      expect(p.profit).toBe(75);
    });

    it('returns a full loss when there is no winning stake', () => {
      const p = computePayout({
        userStake: 50,
        winningPoolTotal: 0,
        losingPoolTotal: 100,
      });
      expect(p.net).toBe(0);
      expect(p.profit).toBe(-50);
    });

    it('handles a losing-pool of zero (only winners staked)', () => {
      const p = computePayout({
        userStake: 40,
        winningPoolTotal: 80,
        losingPoolTotal: 0,
        feeBps: 0,
      });
      // gross = 0.5 * 80 = 40 → no profit
      expect(p.gross).toBe(40);
      expect(p.profit).toBe(0);
    });
  });

  describe('explorerTxUrl', () => {
    it('builds a BaseScan url for base', () => {
      expect(explorerTxUrl('base', '0xabc')).toBe(
        'https://basescan.org/tx/0xabc',
      );
    });
    it('builds a stellar.expert url for stellar', () => {
      expect(explorerTxUrl('stellar', 'HASH')).toContain(
        'stellar.expert/explorer/public/tx/HASH',
      );
    });
  });
});

describe('computeParimutuelOdds', () => {
  it('treats an empty pool as a coin flip rather than dividing by zero', () => {
    const odds = computeParimutuelOdds({ winningPoolTotal: 0, losingPoolTotal: 0 });

    expect(odds.impliedProbability).toBe(0.5);
    expect(odds.decimalOdds).toBe(2);
  });

  it('computes implied probability and decimal odds from an even split', () => {
    const odds = computeParimutuelOdds({ winningPoolTotal: 100, losingPoolTotal: 100 });

    expect(odds.impliedProbability).toBe(0.5);
    expect(odds.decimalOdds).toBe(2);
  });

  it('computes a skewed split correctly', () => {
    const odds = computeParimutuelOdds({ winningPoolTotal: 100, losingPoolTotal: 300 });

    expect(odds.impliedProbability).toBe(0.25);
    expect(odds.decimalOdds).toBe(4);
  });

  it('returns zero odds when this side has no stake at all', () => {
    const odds = computeParimutuelOdds({ winningPoolTotal: 0, losingPoolTotal: 100 });

    expect(odds.impliedProbability).toBe(0);
    expect(odds.decimalOdds).toBe(0);
  });
});

describe('breakEvenProbability', () => {
  it('is 50% for a fair 2x multiplier', () => {
    expect(breakEvenProbability(2)).toBeCloseTo(0.5);
  });

  it('is 100% (impossible) for a multiplier of 0', () => {
    expect(breakEvenProbability(0)).toBe(1);
  });

  it('is lower for a higher multiplier', () => {
    expect(breakEvenProbability(10)).toBeLessThan(breakEvenProbability(2));
  });

  it('clamps to 1 rather than returning a probability above 100%', () => {
    expect(breakEvenProbability(0.5)).toBe(1);
  });
});

describe('projectPosition', () => {
  it('adds the candidate stake into the winning pool before computing the payout', () => {
    const result = projectPosition({
      stakeAmount: 100,
      existingWinningPoolTotal: 100,
      existingLosingPoolTotal: 200,
    });

    // winningPoolTotal becomes 200 (100 existing + 100 candidate), so share = 0.5.
    expect(result.payout.share).toBe(0.5);
    expect(result.payout.gross).toBe(200);
  });

  it('combines protocol and surge fees into a single effective fee', () => {
    const result = projectPosition({
      stakeAmount: 100,
      existingWinningPoolTotal: 100,
      existingLosingPoolTotal: 100,
      protocolFeeBps: 200,
      surgeFeeBps: 300,
    });

    // winningPoolTotal becomes 200 (100 existing + 100 candidate stake), so
    // share = 100/200 = 0.5; totalPool = 300; gross = 150; combined fee = 5% = 7.5; net = 142.5.
    expect(result.payout.fee).toBe(7.5);
    expect(result.payout.net).toBe(142.5);
  });

  it('handles zero opposing stake without producing NaN or Infinity', () => {
    const result = projectPosition({
      stakeAmount: 50,
      existingWinningPoolTotal: 0,
      existingLosingPoolTotal: 0,
    });

    expect(Number.isFinite(result.payout.net)).toBe(true);
    expect(Number.isFinite(result.multiplier)).toBe(true);
    expect(result.payout.profit).toBe(0);
  });

  it('handles a fully dominant outcome (all existing stake on this side)', () => {
    const result = projectPosition({
      stakeAmount: 50,
      existingWinningPoolTotal: 1_000,
      existingLosingPoolTotal: 0,
    });

    expect(result.payout.net).toBe(50);
    expect(result.payout.profit).toBe(0);
    expect(result.odds.impliedProbability).toBe(1);
  });

  it('reports a multiplier consistent with net / stake', () => {
    const result = projectPosition({
      stakeAmount: 100,
      existingWinningPoolTotal: 100,
      existingLosingPoolTotal: 300,
    });

    expect(result.multiplier).toBeCloseTo(result.payout.net / 100);
  });

  it('treats a zero or negative stake as a zero position rather than throwing', () => {
    const zero = projectPosition({ stakeAmount: 0, existingWinningPoolTotal: 100, existingLosingPoolTotal: 100 });
    const negative = projectPosition({
      stakeAmount: -20,
      existingWinningPoolTotal: 100,
      existingLosingPoolTotal: 100,
    });

    expect(zero.multiplier).toBe(0);
    expect(negative.multiplier).toBe(0);
  });
});

describe('projectScenarios', () => {
  const base = {
    stakeAmount: 100,
    existingWinningPoolTotal: 100,
    existingLosingPoolTotal: 100,
    protocolFeeBps: 200,
  };

  it('returns one result per scenario, each tagged with its scenario', () => {
    const scenarios: PoolScenario[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', losingPoolDelta: 500 },
    ];
    const results = projectScenarios(base, scenarios);

    expect(results).toHaveLength(2);
    expect(results[0].scenario.id).toBe('a');
    expect(results[1].scenario.id).toBe('b');
  });

  it('applies a pool-doubling scenario to the existing pools, not the post-stake total', () => {
    const results = projectScenarios(base, [
      { id: 'double', label: 'Double', winningPoolMultiplier: 2, losingPoolMultiplier: 2 },
    ]);

    // existing winning pool 100 * 2 = 200, plus the 100 stake = 300 total winning pool.
    // existing losing pool 100 * 2 = 200. share = 100/300, total pool = 500, gross ≈ 166.67.
    expect(results[0].payout.gross).toBeCloseTo(166.67, 1);
  });

  it('applies an additive opposing-stake-increase scenario', () => {
    const results = projectScenarios(base, [
      { id: 'plus1000', label: '+1000', losingPoolDelta: 1_000 },
    ]);

    // winning pool = 200 (100 existing + 100 stake), losing pool = 1100, total = 1300.
    expect(results[0].payout.gross).toBeCloseTo((100 / 200) * 1_300, 1);
  });

  it('handles a scenario that zeroes out the opposing pool entirely', () => {
    const results = projectScenarios(base, [
      { id: 'no_opponent', label: 'No opponent', losingPoolMultiplier: 0 },
    ]);

    expect(results[0].payout.profit).toBeCloseTo(-2, 1); // just the 2% fee lost, no opposing pool to win from
    expect(Number.isFinite(results[0].payout.net)).toBe(true);
  });
});

describe('defaultScenarios', () => {
  it('includes the current pool and the two named example scenarios from the issue', () => {
    const ids = defaultScenarios().map((scenario) => scenario.id);

    expect(ids).toContain('current');
    expect(ids).toContain('pool_doubles');
    expect(ids).toContain('opposing_plus_1000');
  });

  it('includes a scenario with no opposing stake at all', () => {
    const dominant = defaultScenarios().find((scenario) => scenario.id === 'dominant_outcome');

    expect(dominant?.losingPoolMultiplier).toBe(0);
  });

  it('produces scenarios that all project without error from a representative base', () => {
    const results = projectScenarios(
      { stakeAmount: 100, existingWinningPoolTotal: 500, existingLosingPoolTotal: 500, protocolFeeBps: 200 },
      defaultScenarios(),
    );

    results.forEach((result) => {
      expect(Number.isFinite(result.payout.net)).toBe(true);
      expect(Number.isFinite(result.breakEvenProbability)).toBe(true);
    });
  });
});
