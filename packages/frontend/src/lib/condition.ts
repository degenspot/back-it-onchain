/**
 * Call conditions (FE-04).
 *
 * A call resolves against a condition: the statement that decides YES or NO.
 * Three kinds are supported, modelled as a zod discriminated union so an
 * invalid shape cannot be constructed and a stored shape can be read back
 * safely.
 *
 * The serialized form is what lands in `calls.condition_json`. That column is
 * JSONB and the backend types it as `any`, so the shape is defined here — the
 * `kind` discriminant is what makes it readable later without guessing.
 */

import { z } from 'zod';
import { formatChartData, type FormattedChartData, type RawChartData } from './chart-utils';
import type { ConditionAst } from './validators/condition-schema';

/** Version stamped into every serialized condition. */
export const CONDITION_SCHEMA_VERSION = 1;

/** Largest percentage move that can be expressed, to catch typos like 10000. */
export const MAX_PERCENT_MOVE = 1_000;

/**
 * "Price goes above/below X."
 */
export const targetPriceSchema = z.object({
  kind: z.literal('target_price'),
  direction: z.enum(['above', 'below']),
  price: z
    .number({ message: 'Target price is required' })
    .positive('Target price must be greater than zero')
    .finite('Target price must be a real number'),
});

/**
 * "Price moves up/down by N% from a reference price."
 *
 * The reference is stored rather than resolved at evaluation time so the
 * condition means the same thing later as it did when it was written — a
 * percentage with no anchor is not a testable statement.
 */
export const percentMoveSchema = z.object({
  kind: z.literal('percent_move'),
  direction: z.enum(['up', 'down']),
  percent: z
    .number({ message: 'Percentage is required' })
    .positive('Percentage must be greater than zero')
    .max(MAX_PERCENT_MOVE, `Percentage must be at most ${MAX_PERCENT_MOVE}%`),
  basePrice: z
    .number({ message: 'Reference price is required' })
    .positive('Reference price must be greater than zero')
    .finite('Reference price must be a real number'),
});

/**
 * "Price ends between lower and upper."
 */
export const rangeSchema = z
  .object({
    kind: z.literal('range'),
    lower: z
      .number({ message: 'Lower bound is required' })
      .positive('Lower bound must be greater than zero'),
    upper: z
      .number({ message: 'Upper bound is required' })
      .positive('Upper bound must be greater than zero'),
    /** Whether the bounds themselves count as inside the range. */
    inclusive: z.boolean().default(true),
  })
  .refine((value) => value.lower < value.upper, {
    message: 'Lower bound must be below the upper bound',
    path: ['upper'],
  });

export const conditionSchema = z.discriminatedUnion('kind', [
  targetPriceSchema,
  percentMoveSchema,
  rangeSchema,
]);

export type Condition = z.infer<typeof conditionSchema>;
export type ConditionKind = Condition['kind'];
export type TargetPriceCondition = z.infer<typeof targetPriceSchema>;
export type PercentMoveCondition = z.infer<typeof percentMoveSchema>;
export type RangeCondition = z.infer<typeof rangeSchema>;

export const CONDITION_KINDS: readonly ConditionKind[] = [
  'target_price',
  'percent_move',
  'range',
] as const;

/** Human-readable label for each kind, for tabs and summaries. */
export const CONDITION_KIND_LABELS: Record<ConditionKind, string> = {
  target_price: 'Target price',
  percent_move: 'Percent move',
  range: 'Range',
};

/**
 * The price at which a condition flips, as one or two thresholds.
 *
 * A target price has one; a range has two. Percent moves are reduced to the
 * absolute price they imply, so every kind can be compared and charted the
 * same way.
 */
export function conditionThresholds(condition: Condition): number[] {
  switch (condition.kind) {
    case 'target_price':
      return [condition.price];

    case 'percent_move': {
      const factor = condition.percent / 100;
      const delta = condition.basePrice * factor;

      return [
        condition.direction === 'up'
          ? condition.basePrice + delta
          : condition.basePrice - delta,
      ];
    }

    case 'range':
      return [condition.lower, condition.upper];
  }
}

/**
 * Whether `price` satisfies `condition` — the `price → outcome` preview.
 *
 * Boundaries are explicit rather than incidental: `above`/`below` are strict,
 * so a price exactly at the target does *not* resolve YES. A condition that
 * flips on an exact tie would be unarguable in one direction and arguable in
 * the other, and strict comparison is the reading a participant expects from
 * the word "above".
 */
export function evaluateCondition(condition: Condition, price: number): boolean {
  if (!Number.isFinite(price)) return false;

  switch (condition.kind) {
    case 'target_price':
      return condition.direction === 'above'
        ? price > condition.price
        : price < condition.price;

    case 'percent_move': {
      const [threshold] = conditionThresholds(condition);

      return condition.direction === 'up' ? price >= threshold : price <= threshold;
    }

    case 'range':
      return condition.inclusive
        ? price >= condition.lower && price <= condition.upper
        : price > condition.lower && price < condition.upper;
  }
}

/** Format a number for display without trailing noise. */
function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';

  // Small prices need more precision than large ones; a fixed 2 decimals
  // would render a $0.0001 token as $0.00.
  const decimals = Math.abs(value) >= 1 ? 2 : 6;

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * The condition as a sentence, used for the live preview and the summary.
 */
export function describeCondition(condition: Condition): string {
  switch (condition.kind) {
    case 'target_price':
      return `Price goes ${condition.direction} $${formatPrice(condition.price)}`;

    case 'percent_move': {
      const [threshold] = conditionThresholds(condition);

      return `Price moves ${condition.direction} ${condition.percent}% from $${formatPrice(
        condition.basePrice,
      )} (to $${formatPrice(threshold)})`;
    }

    case 'range': {
      const bounds = condition.inclusive ? 'inclusive' : 'exclusive';

      return `Price ends between $${formatPrice(condition.lower)} and $${formatPrice(
        condition.upper,
      )} (${bounds})`;
    }
  }
}

/** The shape written to `calls.condition_json`. */
export interface SerializedCondition {
  version: number;
  kind: ConditionKind;
  /** Sentence form, so a reader without this module can still tell what it means. */
  summary: string;
  /** Threshold prices, for indexers and charts that do not parse the payload. */
  thresholds: number[];
  params: Condition;
}

/**
 * Serialize for storage.
 *
 * `summary` and `thresholds` are denormalised on purpose: `condition_json` is
 * read by the backend and by indexers that have no reason to reimplement this
 * evaluation logic, and a stored sentence keeps an old call readable even if
 * the shape changes.
 */
export function serializeCondition(condition: Condition): SerializedCondition {
  return {
    version: CONDITION_SCHEMA_VERSION,
    kind: condition.kind,
    summary: describeCondition(condition),
    thresholds: conditionThresholds(condition),
    params: condition,
  };
}

/**
 * Read a condition back from stored JSON.
 *
 * Returns `null` rather than throwing: a malformed or future-version payload
 * is a display problem, not a crash, and callers render a fallback.
 */
export function parseCondition(value: unknown): Condition | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;

  // Accept both the wrapper and a bare condition, so a payload written by an
  // older client still reads.
  const candidate = 'params' in record ? record.params : record;

  const result = conditionSchema.safeParse(candidate);

  return result.success ? result.data : null;
}

/**
 * A price series spanning the condition's thresholds, for the preview chart.
 *
 * Reuses `chart-utils.formatChartData` rather than formatting here, so the
 * preview axis matches every other chart in the app.
 */
export function conditionPreviewSeries(
  condition: Condition,
  options: { points?: number; startTime?: number; stepMs?: number } = {},
): FormattedChartData[] {
  const { points = 24, startTime = 0, stepMs = 3_600_000 } = options;

  const thresholds = conditionThresholds(condition);
  const low = Math.min(...thresholds);
  const high = Math.max(...thresholds);

  // Pad the window so the thresholds are not flush against the chart edges.
  const padding = Math.max((high - low) * 0.5, high * 0.1);
  const from = Math.max(low - padding, 0);
  const to = high + padding;

  const raw: RawChartData[] = Array.from({ length: points }, (_, index) => {
    const progress = points === 1 ? 0 : index / (points - 1);

    return {
      timestamp: startTime + index * stepMs,
      price: from + (to - from) * progress,
    };
  });

  return formatChartData(raw);
}

// ── Multi-outcome pool distribution (FE-001) ───────────────────────────────

/** A single outcome's staked reserve, as tracked by the pool. */
export interface OutcomeReserve {
  id: string;
  total: number;
}

/** An outcome's normalized share of the pool, 0-100. */
export interface OutcomePercentage {
  id: string;
  percent: number;
}

/**
 * Normalize outcome reserves into percentages that sum to 100.
 *
 * A fresh multi-outcome market has no stakes yet, so every reserve is zero.
 * Dividing by a zero total would be meaningless, and the honest answer for an
 * undecided market is an even split across whatever outcomes exist, not a
 * crash or a stack of `NaN`s.
 */
export function normalizeOutcomePercentages(reserves: OutcomeReserve[]): OutcomePercentage[] {
  if (reserves.length === 0) return [];

  const total = reserves.reduce((sum, reserve) => sum + Math.max(0, reserve.total), 0);

  if (total <= 0) {
    const even = 100 / reserves.length;

    return reserves.map((reserve) => ({ id: reserve.id, percent: even }));
  }

  return reserves.map((reserve) => ({
    id: reserve.id,
    percent: (Math.max(0, reserve.total) / total) * 100,
  }));
}

/**
 * A deterministic color for outcome `index` of `count`, spaced evenly around
 * the hue wheel so any number of outcomes (2 to 32) gets visually distinct,
 * reproducible colors without a lookup table to maintain.
 */
export function outcomeColor(index: number, count: number): string {
  if (count <= 0) return 'hsl(0, 70%, 50%)';

  const hue = Math.round((360 * index) / count);

  return `hsl(${hue}, 70%, 50%)`;
}

// ── Condition-AST bridge (FE-005) ───────────────────────────────────────────

/**
 * Express a builder condition as the raw AST syntax, given an expiry.
 *
 * `percent_move` has no AST equivalent of its own, so it is reduced to the
 * absolute price threshold it implies, same as {@link conditionThresholds}
 * does for the preview chart. `MULTI_STEP_LADDER` has no builder equivalent
 * and so is never produced here.
 */
export function toConditionAst(condition: Condition, expiresAt: number): ConditionAst {
  switch (condition.kind) {
    case 'target_price':
      return condition.direction === 'above'
        ? { type: 'PRICE_ABOVE', price: condition.price, expiresAt }
        : { type: 'PRICE_BELOW', price: condition.price, expiresAt };

    case 'percent_move': {
      const [threshold] = conditionThresholds(condition);

      return condition.direction === 'up'
        ? { type: 'PRICE_ABOVE', price: threshold, expiresAt }
        : { type: 'PRICE_BELOW', price: threshold, expiresAt };
    }

    case 'range':
      return { type: 'RANGE_BOUND', lower: condition.lower, upper: condition.upper, expiresAt };
  }
}

/**
 * Read a builder condition back out of an AST, where one exists.
 *
 * Returns `null` for `MULTI_STEP_LADDER`, which the three-kind builder union
 * has no way to represent, rather than lossily collapsing it to one of its
 * steps.
 */
export function fromConditionAst(ast: ConditionAst): Condition | null {
  switch (ast.type) {
    case 'PRICE_ABOVE':
      return { kind: 'target_price', direction: 'above', price: ast.price };

    case 'PRICE_BELOW':
      return { kind: 'target_price', direction: 'below', price: ast.price };

    case 'RANGE_BOUND':
      return { kind: 'range', lower: ast.lower, upper: ast.upper, inclusive: true };

    case 'MULTI_STEP_LADDER':
      return null;
  }
}
