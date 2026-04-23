import { describe, it, expect } from 'vitest';
import { generateMockPriceData, generateAreaData } from './chart-utils';

describe('chart-utils', () => {
  describe('generateMockPriceData', () => {
    it('should generate requested number of data points', () => {
      const days = 10;
      const data = generateMockPriceData(100, days);
      expect(data.length).toBe(days + 1);
    });

    it('should have correct data structure', () => {
      const data = generateMockPriceData(100, 1);
      const first = data[0];
      expect(first).toHaveProperty('time');
      expect(first).toHaveProperty('open');
      expect(first).toHaveProperty('high');
      expect(first).toHaveProperty('low');
      expect(first).toHaveProperty('close');
    });

    it('should respect the start price', () => {
      const startPrice = 50;
      const data = generateMockPriceData(startPrice, 10);
      expect(data[0].open).toBe(startPrice);
    });
  });

  describe('generateAreaData', () => {
    it('should generate requested number of data points', () => {
      const days = 15;
      const data = generateAreaData(100, days);
      expect(data.length).toBe(days + 1);
    });

    it('should have correct data structure', () => {
      const data = generateAreaData(100, 1);
      const first = data[0];
      expect(first).toHaveProperty('time');
      expect(first).toHaveProperty('value');
    });
  });
});
