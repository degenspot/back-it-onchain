import { describe, it, expect } from 'vitest';
import {
  CONDITION_SCHEMA_VERSION,
  MAX_PERCENT_MOVE,
  conditionPreviewSeries,
  conditionSchema,
  conditionThresholds,
  describeCondition,
  evaluateCondition,
  fromConditionAst,
  normalizeOutcomePercentages,
  outcomeColor,
  parseCondition,
  serializeCondition,
  toConditionAst,
  type Condition,
} from './condition';
import { MIN_LEAD_TIME_MS } from './validators/condition-schema';

const FAR_FUTURE = Date.now() + MIN_LEAD_TIME_MS + 24 * 60 * 60 * 1000;

const target: Condition = { kind: 'target_price', direction: 'above', price: 100 };
const below: Condition = { kind: 'target_price', direction: 'below', price: 100 };
const up: Condition = { kind: 'percent_move', direction: 'up', percent: 20, basePrice: 100 };
const down: Condition = { kind: 'percent_move', direction: 'down', percent: 20, basePrice: 100 };
const range: Condition = { kind: 'range', lower: 90, upper: 110, inclusive: true };

describe('condition schema', () => {
  it('accepts each of the three kinds', () => {
    for (const condition of [target, up, range]) {
      expect(conditionSchema.safeParse(condition).success).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    expect(conditionSchema.safeParse({ kind: 'moon', price: 1 }).success).toBe(false);
  });

  it('rejects a non-positive target price', () => {
    for (const price of [0, -1]) {
      expect(
        conditionSchema.safeParse({ kind: 'target_price', direction: 'above', price }).success,
      ).toBe(false);
    }
  });

  it('rejects a percentage above the maximum', () => {
    expect(
      conditionSchema.safeParse({
        kind: 'percent_move',
        direction: 'up',
        percent: MAX_PERCENT_MOVE + 1,
        basePrice: 100,
      }).success,
    ).toBe(false);
  });

  // A range whose bounds are the wrong way round can never resolve YES, so it
  // has to be caught at entry rather than becoming an unwinnable call.
  it('rejects a range whose lower bound is not below the upper', () => {
    for (const [lower, upper] of [
      [110, 90],
      [100, 100],
    ]) {
      const result = conditionSchema.safeParse({ kind: 'range', lower, upper, inclusive: true });

      expect(result.success).toBe(false);
    }
  });

  it('defaults a range to inclusive', () => {
    const parsed = conditionSchema.parse({ kind: 'range', lower: 1, upper: 2 });

    expect(parsed).toMatchObject({ inclusive: true });
  });
});

describe('evaluateCondition', () => {
  it('resolves a target price above', () => {
    expect(evaluateCondition(target, 101)).toBe(true);
    expect(evaluateCondition(target, 99)).toBe(false);
  });

  it('resolves a target price below', () => {
    expect(evaluateCondition(below, 99)).toBe(true);
    expect(evaluateCondition(below, 101)).toBe(false);
  });

  // The boundary is the case people argue about, so it is pinned rather than
  // left to whichever comparison happened to be written.
  it('treats "above" and "below" as strict at the exact target', () => {
    expect(evaluateCondition(target, 100)).toBe(false);
    expect(evaluateCondition(below, 100)).toBe(false);
  });

  it('resolves an upward percent move at and past the threshold', () => {
    // +20% of 100 is 120.
    expect(evaluateCondition(up, 119.99)).toBe(false);
    expect(evaluateCondition(up, 120)).toBe(true);
    expect(evaluateCondition(up, 500)).toBe(true);
  });

  it('resolves a downward percent move', () => {
    // -20% of 100 is 80.
    expect(evaluateCondition(down, 80.01)).toBe(false);
    expect(evaluateCondition(down, 80)).toBe(true);
    expect(evaluateCondition(down, 10)).toBe(true);
  });

  it('resolves an inclusive range at its bounds', () => {
    expect(evaluateCondition(range, 90)).toBe(true);
    expect(evaluateCondition(range, 110)).toBe(true);
    expect(evaluateCondition(range, 100)).toBe(true);
    expect(evaluateCondition(range, 89.99)).toBe(false);
    expect(evaluateCondition(range, 110.01)).toBe(false);
  });

  it('excludes the bounds when the range is exclusive', () => {
    const exclusive: Condition = { ...range, inclusive: false };

    expect(evaluateCondition(exclusive, 90)).toBe(false);
    expect(evaluateCondition(exclusive, 110)).toBe(false);
    expect(evaluateCondition(exclusive, 100)).toBe(true);
  });

  it('never resolves YES for a non-finite price', () => {
    for (const price of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(evaluateCondition(target, price)).toBe(false);
      expect(evaluateCondition(range, price)).toBe(false);
    }
  });
});

describe('conditionThresholds', () => {
  it('gives one threshold for a target price', () => {
    expect(conditionThresholds(target)).toEqual([100]);
  });

  it('reduces a percent move to the absolute price it implies', () => {
    expect(conditionThresholds(up)).toEqual([120]);
    expect(conditionThresholds(down)).toEqual([80]);
  });

  it('gives both bounds for a range', () => {
    expect(conditionThresholds(range)).toEqual([90, 110]);
  });

  // The threshold is what the preview draws, so it has to agree with the
  // evaluator or the chart would contradict the outcome.
  it('agrees with the evaluator at the threshold', () => {
    for (const condition of [up, down]) {
      const [threshold] = conditionThresholds(condition);

      expect(evaluateCondition(condition, threshold)).toBe(true);
    }
  });
});

describe('describeCondition', () => {
  it('describes each kind in words', () => {
    expect(describeCondition(target)).toContain('above');
    expect(describeCondition(target)).toContain('100');

    expect(describeCondition(up)).toContain('20%');
    expect(describeCondition(up)).toContain('120');

    expect(describeCondition(range)).toContain('90');
    expect(describeCondition(range)).toContain('110');
    expect(describeCondition(range)).toContain('inclusive');
  });

  it('keeps precision on sub-dollar prices', () => {
    const penny: Condition = { kind: 'target_price', direction: 'above', price: 0.000123 };

    // A fixed two decimals would render this as $0.00.
    expect(describeCondition(penny)).toContain('0.000123');
  });
});

describe('serialization', () => {
  it('round-trips through serialize and parse', () => {
    for (const condition of [target, below, up, down, range]) {
      const serialized = serializeCondition(condition);

      expect(parseCondition(serialized)).toEqual(condition);
    }
  });

  it('stamps a version, kind, summary and thresholds', () => {
    const serialized = serializeCondition(up);

    expect(serialized.version).toBe(CONDITION_SCHEMA_VERSION);
    expect(serialized.kind).toBe('percent_move');
    expect(serialized.summary).toBe(describeCondition(up));
    expect(serialized.thresholds).toEqual([120]);
  });

  it('survives a JSON round-trip, which is how it is actually stored', () => {
    const stored = JSON.parse(JSON.stringify(serializeCondition(range)));

    expect(parseCondition(stored)).toEqual(range);
  });

  // An older client may have written the condition without the wrapper.
  it('parses a bare condition as well as a wrapped one', () => {
    expect(parseCondition(target)).toEqual(target);
  });

  it('returns null for anything unreadable rather than throwing', () => {
    for (const value of [null, undefined, 'nope', 42, {}, { kind: 'moon' }, { params: {} }]) {
      expect(parseCondition(value)).toBeNull();
    }
  });
});

describe('conditionPreviewSeries', () => {
  it('produces a series formatted by chart-utils', () => {
    const series = conditionPreviewSeries(target, { points: 5 });

    expect(series).toHaveLength(5);
    // formatChartData yields { time, value } pairs.
    expect(series[0]).toHaveProperty('time');
    expect(series[0]).toHaveProperty('value');
    expect(typeof series[0].time).toBe('string');
  });

  it('spans the thresholds so the crossing point is visible', () => {
    const series = conditionPreviewSeries(range, { points: 20 });
    const values = series.map((point) => point.value);

    expect(Math.min(...values)).toBeLessThan(90);
    expect(Math.max(...values)).toBeGreaterThan(110);
  });

  it('never dips below zero, because a negative price is not meaningful', () => {
    const cheap: Condition = { kind: 'target_price', direction: 'above', price: 0.01 };

    for (const point of conditionPreviewSeries(cheap)) {
      expect(point.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles a single-point request without dividing by zero', () => {
    const series = conditionPreviewSeries(target, { points: 1 });

    expect(series).toHaveLength(1);
    expect(Number.isFinite(series[0].value)).toBe(true);
  });
});

describe('normalizeOutcomePercentages', () => {
  it('splits an all-zero pool evenly across outcomes', () => {
    const result = normalizeOutcomePercentages([
      { id: 'a', total: 0 },
      { id: 'b', total: 0 },
      { id: 'c', total: 0 },
      { id: 'd', total: 0 },
    ]);

    expect(result.every((entry) => entry.percent === 25)).toBe(true);
  });

  it('normalizes proportionally to reserves and sums to 100', () => {
    const result = normalizeOutcomePercentages([
      { id: 'a', total: 300 },
      { id: 'b', total: 100 },
    ]);

    expect(result.find((entry) => entry.id === 'a')?.percent).toBeCloseTo(75);
    expect(result.find((entry) => entry.id === 'b')?.percent).toBeCloseTo(25);
    expect(result.reduce((sum, entry) => sum + entry.percent, 0)).toBeCloseTo(100);
  });

  it('clamps negative reserves to zero rather than distorting the split', () => {
    const result = normalizeOutcomePercentages([
      { id: 'a', total: 100 },
      { id: 'b', total: -50 },
    ]);

    expect(result.find((entry) => entry.id === 'b')?.percent).toBe(0);
    expect(result.find((entry) => entry.id === 'a')?.percent).toBe(100);
  });

  it('returns an empty array for an empty pool', () => {
    expect(normalizeOutcomePercentages([])).toEqual([]);
  });

  it('handles the 32-outcome ceiling without losing precision on the sum', () => {
    const reserves = Array.from({ length: 32 }, (_, index) => ({ id: `o${index}`, total: index + 1 }));
    const result = normalizeOutcomePercentages(reserves);

    expect(result).toHaveLength(32);
    expect(result.reduce((sum, entry) => sum + entry.percent, 0)).toBeCloseTo(100);
  });
});

describe('outcomeColor', () => {
  it('returns distinct hues for each outcome in a set', () => {
    const colors = Array.from({ length: 5 }, (_, index) => outcomeColor(index, 5));

    expect(new Set(colors).size).toBe(5);
  });

  it('is deterministic for the same index and count', () => {
    expect(outcomeColor(2, 8)).toBe(outcomeColor(2, 8));
  });

  it('does not divide by zero for an empty outcome set', () => {
    expect(() => outcomeColor(0, 0)).not.toThrow();
  });
});

describe('toConditionAst / fromConditionAst', () => {
  it('round-trips a target_price(above) condition through PRICE_ABOVE', () => {
    const condition: Condition = { kind: 'target_price', direction: 'above', price: 100 };
    const ast = toConditionAst(condition, FAR_FUTURE);

    expect(ast).toMatchObject({ type: 'PRICE_ABOVE', price: 100 });
    expect(fromConditionAst(ast)).toEqual(condition);
  });

  it('round-trips a target_price(below) condition through PRICE_BELOW', () => {
    const condition: Condition = { kind: 'target_price', direction: 'below', price: 90 };
    const ast = toConditionAst(condition, FAR_FUTURE);

    expect(ast).toMatchObject({ type: 'PRICE_BELOW', price: 90 });
    expect(fromConditionAst(ast)).toEqual(condition);
  });

  it('reduces a percent_move condition to its absolute threshold', () => {
    const condition: Condition = { kind: 'percent_move', direction: 'up', percent: 10, basePrice: 100 };
    const ast = toConditionAst(condition, FAR_FUTURE);

    expect(ast).toMatchObject({ type: 'PRICE_ABOVE', price: 110 });
  });

  it('round-trips a range condition through RANGE_BOUND', () => {
    const condition: Condition = { kind: 'range', lower: 90, upper: 110, inclusive: true };
    const ast = toConditionAst(condition, FAR_FUTURE);

    expect(ast).toMatchObject({ type: 'RANGE_BOUND', lower: 90, upper: 110 });
    expect(fromConditionAst(ast)).toEqual(condition);
  });

  it('returns null converting a MULTI_STEP_LADDER back to a builder condition', () => {
    const result = fromConditionAst({
      type: 'MULTI_STEP_LADDER',
      steps: [
        { price: 100, multiplier: 2 },
        { price: 150, multiplier: 5 },
      ],
      expiresAt: FAR_FUTURE,
    });

    expect(result).toBeNull();
  });
});
