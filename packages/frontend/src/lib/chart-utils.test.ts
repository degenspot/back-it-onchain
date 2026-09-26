import { describe, it, expect } from 'vitest';
import {
  formatChartData,
  RawChartData,
  buildEvidenceMarkers,
  crosshairYFromPrice,
  percentDelta,
  priceFromCrosshairY,
  projectedPayoutMultiplier,
  type CandleData,
} from './chart-utils';

describe('chart-utils', () => {
  describe('formatChartData', () => {
    it('should correctly format raw chart data using close price', () => {
      const rawData: RawChartData[] = [
        { timestamp: 1672531200000, price: 100 },
        { timestamp: 1672617600000, price: 105 },
      ];

      const result = formatChartData(rawData);

      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(100);
      expect(result[1].value).toBe(105);

      expect(typeof result[0].time).toBe('string');
    });

    it('should handle empty data arrays', () => {
      const result = formatChartData([]);
      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });
  });

  describe('buildEvidenceMarkers', () => {
    it('should assign markers based on event type', () => {
      const markers = buildEvidenceMarkers([
        { time: '2023-01-01', label: 'Start', type: 'start' },
        { time: '2023-01-02', label: 'End', type: 'end' },
        { time: '2023-01-03', label: 'Settlement', type: 'settlement' },
      ]);

      expect(markers).toHaveLength(3);
      expect(markers[0].color).toBe('#8b5cf6');
      expect(markers[1].color).toBe('#ec4899');
      expect(markers[2].color).toBe('#22c55e');
      expect(markers[2].shape).toBe('circle');
    });
  });
});

describe('priceFromCrosshairY / crosshairYFromPrice', () => {
  it('maps the top of the chart to the max price and the bottom to the min price', () => {
    expect(priceFromCrosshairY(0, 300, 90, 110)).toBe(110);
    expect(priceFromCrosshairY(300, 300, 90, 110)).toBe(90);
  });

  it('maps the vertical center to the midpoint price', () => {
    expect(priceFromCrosshairY(150, 300, 90, 110)).toBe(100);
  });

  it('clamps a Y position past either edge to the edge price', () => {
    expect(priceFromCrosshairY(-50, 300, 90, 110)).toBe(110);
    expect(priceFromCrosshairY(400, 300, 90, 110)).toBe(90);
  });

  it('returns the min price for a degenerate chart height or price range', () => {
    expect(priceFromCrosshairY(100, 0, 90, 110)).toBe(90);
    expect(priceFromCrosshairY(100, 300, 100, 100)).toBe(100);
  });

  it('is the inverse of crosshairYFromPrice at the extremes and the midpoint', () => {
    expect(crosshairYFromPrice(110, 300, 90, 110)).toBe(0);
    expect(crosshairYFromPrice(90, 300, 90, 110)).toBe(300);
    expect(crosshairYFromPrice(100, 300, 90, 110)).toBe(150);
  });

  it('clamps a price outside the range to the nearest edge Y', () => {
    expect(crosshairYFromPrice(200, 300, 90, 110)).toBe(0);
    expect(crosshairYFromPrice(0, 300, 90, 110)).toBe(300);
  });

  it('round-trips price -> Y -> price for values inside the range', () => {
    const price = 103.5;
    const y = crosshairYFromPrice(price, 300, 90, 110);

    expect(priceFromCrosshairY(y, 300, 90, 110)).toBeCloseTo(price);
  });
});

describe('percentDelta', () => {
  it('computes a positive delta above the reference', () => {
    expect(percentDelta(110, 100)).toBeCloseTo(10);
  });

  it('computes a negative delta below the reference', () => {
    expect(percentDelta(90, 100)).toBeCloseTo(-10);
  });

  it('returns 0 for a zero or non-finite reference rather than dividing by zero', () => {
    expect(percentDelta(110, 0)).toBe(0);
    expect(percentDelta(110, Number.NaN)).toBe(0);
  });
});

describe('projectedPayoutMultiplier', () => {
  it('matches computePayout net/stake for an ordinary pool', () => {
    const multiplier = projectedPayoutMultiplier({
      userStake: 100,
      winningPoolTotal: 400,
      losingPoolTotal: 400,
      feeBps: 200,
    });

    // Share is 100/400 = 0.25 of an 800 pool = 200 gross, minus 2% fee = 196 net.
    expect(multiplier).toBeCloseTo(1.96);
  });

  it('returns 0 for a zero or negative stake instead of dividing by zero', () => {
    expect(
      projectedPayoutMultiplier({ userStake: 0, winningPoolTotal: 100, losingPoolTotal: 100 }),
    ).toBe(0);
    expect(
      projectedPayoutMultiplier({ userStake: -5, winningPoolTotal: 100, losingPoolTotal: 100 }),
    ).toBe(0);
  });

  it('is 1x break-even when there is no opposing stake and no fee', () => {
    const multiplier = projectedPayoutMultiplier({
      userStake: 50,
      winningPoolTotal: 200,
      losingPoolTotal: 0,
    });

    expect(multiplier).toBeCloseTo(1);
  });
});
