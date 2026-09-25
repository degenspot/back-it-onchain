import { BrierScoreService, CalibrationPoint } from './brier-score.service';
import { BadRequestException } from '@nestjs/common';

describe('BrierScoreService', () => {
  let service: BrierScoreService;

  beforeEach(() => {
    service = new BrierScoreService();
  });

  describe('computeBrierScore', () => {
    it('returns 0 for a perfect predictor (p=1 always correct, p=0 always wrong-outcome)', () => {
      const points: CalibrationPoint[] = [
        { probability: 1, outcome: true },
        { probability: 0, outcome: false },
      ];
      expect(service.computeBrierScore(points)).toBe(0);
    });

    it('returns 1 for the worst possible predictor (maximally confident and always wrong)', () => {
      const points: CalibrationPoint[] = [
        { probability: 1, outcome: false },
        { probability: 0, outcome: true },
      ];
      expect(service.computeBrierScore(points)).toBe(1);
    });

    it('returns 0.25 for an always-uncertain (p=0.5) predictor regardless of outcome', () => {
      const points: CalibrationPoint[] = [
        { probability: 0.5, outcome: true },
        { probability: 0.5, outcome: false },
      ];
      expect(service.computeBrierScore(points)).toBeCloseTo(0.25);
    });

    it('matches a hand-computed value for a mixed set of predictions', () => {
      // (0.9-1)^2=0.01, (0.2-0)^2=0.04, (0.6-1)^2=0.16 -> mean = 0.21/3 = 0.07
      const points: CalibrationPoint[] = [
        { probability: 0.9, outcome: true },
        { probability: 0.2, outcome: false },
        { probability: 0.6, outcome: true },
      ];
      expect(service.computeBrierScore(points)).toBeCloseTo(0.07, 10);
    });

    it('returns 0 for an empty prediction set', () => {
      expect(service.computeBrierScore([])).toBe(0);
    });

    it('rejects a probability outside [0, 1]', () => {
      expect(() =>
        service.computeBrierScore([{ probability: 1.5, outcome: true }])
      ).toThrow(BadRequestException);
      expect(() =>
        service.computeBrierScore([{ probability: -0.1, outcome: false }])
      ).toThrow(BadRequestException);
    });
  });

  describe('computeLogLoss', () => {
    it('is close to 0 for a highly confident, correct predictor', () => {
      const points: CalibrationPoint[] = [
        { probability: 0.99, outcome: true },
        { probability: 0.01, outcome: false },
      ];
      expect(service.computeLogLoss(points)).toBeLessThan(0.02);
    });

    it('is large for a highly confident, wrong predictor', () => {
      const points: CalibrationPoint[] = [
        { probability: 0.99, outcome: false },
        { probability: 0.01, outcome: true },
      ];
      expect(service.computeLogLoss(points)).toBeGreaterThan(4);
    });

    it('equals -ln(0.5) for an always-uncertain (p=0.5) predictor', () => {
      const points: CalibrationPoint[] = [
        { probability: 0.5, outcome: true },
        { probability: 0.5, outcome: false },
      ];
      expect(service.computeLogLoss(points)).toBeCloseTo(-Math.log(0.5), 10);
    });

    it('does not throw on exactly 0 or 1 probabilities (clamped internally)', () => {
      const points: CalibrationPoint[] = [
        { probability: 1, outcome: true },
        { probability: 0, outcome: false },
      ];
      expect(() => service.computeLogLoss(points)).not.toThrow();
      expect(service.computeLogLoss(points)).toBeCloseTo(0, 5);
    });

    it('returns 0 for an empty prediction set', () => {
      expect(service.computeLogLoss([])).toBe(0);
    });
  });

  describe('computeCalibrationCurve', () => {
    it('groups predictions into deciles and reports mean predicted vs observed frequency', () => {
      const points: CalibrationPoint[] = [
        { probability: 0.72, outcome: true },
        { probability: 0.78, outcome: false },
        { probability: 0.15, outcome: false },
      ];
      const curve = service.computeCalibrationCurve(points, 10);

      const highBucket = curve.find((b) => Math.abs(b.bucketStart - 0.7) < 1e-9);
      expect(highBucket).toBeDefined();
      expect(highBucket!.count).toBe(2);
      expect(highBucket!.meanPredicted).toBeCloseTo(0.75, 10);
      expect(highBucket!.observedFrequency).toBeCloseTo(0.5, 10);

      const lowBucket = curve.find((b) => Math.abs(b.bucketStart - 0.1) < 1e-9);
      expect(lowBucket).toBeDefined();
      expect(lowBucket!.count).toBe(1);
      expect(lowBucket!.observedFrequency).toBe(0);
    });

    it('omits empty buckets', () => {
      const curve = service.computeCalibrationCurve([{ probability: 0.95, outcome: true }], 10);
      expect(curve).toHaveLength(1);
      expect(curve[0].bucketStart).toBeCloseTo(0.9, 10);
    });

    it('puts a probability of exactly 1.0 into the last bucket, not an out-of-range one', () => {
      const curve = service.computeCalibrationCurve([{ probability: 1, outcome: true }], 10);
      expect(curve).toHaveLength(1);
      expect(curve[0].bucketStart).toBeCloseTo(0.9, 10);
    });

    it('rejects a bucketCount below 1', () => {
      expect(() => service.computeCalibrationCurve([], 0)).toThrow(BadRequestException);
    });
  });
});
