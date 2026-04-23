import { describe, it, expect } from 'vitest';
import { formatChartData, RawChartData } from './chart-utils';

describe('chart-utils', () => {
  describe('formatChartData', () => {
    it('should correctly format raw chart data', () => {
      // Mock raw data with specific timestamps
      const rawData: RawChartData[] = [
        { timestamp: 1672531200000, price: 100 }, // 2023-01-01 00:00:00 UTC
        { timestamp: 1672617600000, price: 105 }, // 2023-01-02 00:00:00 UTC
      ];

      const result = formatChartData(rawData);

      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(100);
      expect(result[1].value).toBe(105);
      
      // We expect some time string, the exact string depends on the timezone
      // We can test if the 'time' property exists and is a string
      expect(typeof result[0].time).toBe('string');
      expect(typeof result[1].time).toBe('string');
      
      // And we can test for the specific format MM/DD HH:mm
      expect(result[0].time).toMatch(/^\d{1,2}\/\d{1,2} \d{1,2}:\d{2}$/);
    });

    it('should handle empty data arrays', () => {
      const result = formatChartData([]);
      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });
  });
});
