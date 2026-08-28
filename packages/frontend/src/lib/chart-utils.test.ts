import { describe, it, expect } from 'vitest';
import { formatChartData, RawChartData, buildEvidenceMarkers, type CandleData } from './chart-utils';

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
