import { Injectable, BadRequestException } from '@nestjs/common';

/**
 * Brier score & logarithmic loss calculation (BE-029).
 *
 * Evaluates probabilistic calibration for predictors: given the probability
 * a predictor assigned to an outcome and whether that outcome actually
 * happened, computes how well-calibrated their predictions were. Lower is
 * better for both metrics — 0.0 is a perfect prediction.
 *
 * Self-contained: pure math over `(probability, outcome)` pairs, with no
 * database access. `UserReputationEntity` persistence and the
 * settlement-triggered recalculation hook are a separate concern for
 * whichever service owns fetching a predictor's resolved-call history —
 * this module is the calculation primitive that consumes it.
 */

export interface CalibrationPoint {
  /** Probability the predictor assigned to the outcome occurring, in [0, 1]. */
  probability: number;
  /** Whether the predicted outcome actually occurred. */
  outcome: boolean;
}

export interface CalibrationBucket {
  /** Lower bound of the probability bucket, e.g. 0.7 for the "70-80%" bucket. */
  bucketStart: number;
  /** Number of predictions whose probability fell in this bucket. */
  count: number;
  /** Mean predicted probability within this bucket. */
  meanPredicted: number;
  /** Fraction of predictions in this bucket that actually occurred. */
  observedFrequency: number;
}

const EPSILON = 1e-15; // clamp to avoid log(0) in log loss

@Injectable()
export class BrierScoreService {
  /**
   * Mean Brier score over `points`: `(1/N) * sum((p_t - o_t)^2)`.
   * 0.0 is a perfect predictor; 1.0 is the worst possible (maximally
   * confident and always wrong).
   */
  computeBrierScore(points: CalibrationPoint[]): number {
    this.assertValidPoints(points);
    if (points.length === 0) return 0;

    const sumSquaredError = points.reduce((sum, { probability, outcome }) => {
      const o = outcome ? 1 : 0;
      const error = probability - o;
      return sum + error * error;
    }, 0);

    return sumSquaredError / points.length;
  }

  /**
   * Mean logarithmic loss over `points`:
   * `-(1/N) * sum(o_t * ln(p_t) + (1 - o_t) * ln(1 - p_t))`.
   * Probabilities are clamped away from exactly 0/1 to avoid `ln(0)`.
   */
  computeLogLoss(points: CalibrationPoint[]): number {
    this.assertValidPoints(points);
    if (points.length === 0) return 0;

    const sum = points.reduce((acc, { probability, outcome }) => {
      const p = Math.min(Math.max(probability, EPSILON), 1 - EPSILON);
      const o = outcome ? 1 : 0;
      return acc + (o * Math.log(p) + (1 - o) * Math.log(1 - p));
    }, 0);

    return -sum / points.length;
  }

  /**
   * Groups `points` into `bucketCount` equal-width probability buckets
   * (default 10 → deciles) and reports, per bucket, the mean predicted
   * probability vs. the observed frequency of the outcome actually
   * occurring. A well-calibrated predictor has `meanPredicted` close to
   * `observedFrequency` in every bucket. Empty buckets are omitted.
   */
  computeCalibrationCurve(points: CalibrationPoint[], bucketCount = 10): CalibrationBucket[] {
    this.assertValidPoints(points);
    if (bucketCount < 1) {
      throw new BadRequestException('bucketCount must be at least 1');
    }

    const bucketWidth = 1 / bucketCount;
    const buckets: { sumP: number; sumO: number; count: number }[] = Array.from(
      { length: bucketCount },
      () => ({ sumP: 0, sumO: 0, count: 0 })
    );

    for (const { probability, outcome } of points) {
      const index = Math.min(Math.floor(probability / bucketWidth), bucketCount - 1);
      buckets[index].sumP += probability;
      buckets[index].sumO += outcome ? 1 : 0;
      buckets[index].count += 1;
    }

    return buckets
      .map((bucket, index) => ({
        bucketStart: index * bucketWidth,
        count: bucket.count,
        meanPredicted: bucket.count > 0 ? bucket.sumP / bucket.count : 0,
        observedFrequency: bucket.count > 0 ? bucket.sumO / bucket.count : 0,
      }))
      .filter((bucket) => bucket.count > 0);
  }

  private assertValidPoints(points: CalibrationPoint[]): void {
    for (const { probability } of points) {
      if (
        typeof probability !== 'number' ||
        Number.isNaN(probability) ||
        probability < 0 ||
        probability > 1
      ) {
        throw new BadRequestException(
          `Invalid probability ${probability}: must be a number in [0, 1]`
        );
      }
    }
  }
}
