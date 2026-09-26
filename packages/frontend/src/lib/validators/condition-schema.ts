/**
 * Raw market-condition syntax: validation and natural-language explanation
 * (FE-005).
 *
 * This is a second, independent representation of a condition from the one
 * in `condition.ts`. That module models the three kinds the visual
 * ConditionBuilder edits (`target_price` / `percent_move` / `range`) as a
 * discriminated union tuned for a form. This module models the raw
 * `PRICE_ABOVE` / `PRICE_BELOW` / `RANGE_BOUND` / `MULTI_STEP_LADDER` syntax
 * a power user (or an external integration) might hand-write as JSON, plus
 * an expiry every condition carries. `toConditionAst`/`fromConditionAst` in
 * `condition.ts` bridge the two where a mapping exists.
 */

import { z } from 'zod';

/** A condition must resolve at least this far in the future when validated. */
export const MIN_LEAD_TIME_MS = 60 * 60 * 1000;

/** Small, dependency-free number formatter, kept local to avoid a cycle with `condition.ts`. */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';

  const decimals = Math.abs(value) >= 1 ? 2 : 6;

  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function formatExpiry(ms: number): string {
  if (!Number.isFinite(ms)) return 'an unknown date';

  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const expiresAtSchema = z
  .number({ message: 'Expiry timestamp is required' })
  .refine((value) => Number.isFinite(value), 'Expiry must be a real number')
  .refine((value) => value > Date.now() + MIN_LEAD_TIME_MS, {
    message: 'Expiry must be at least 1 hour from now',
  });

export const priceAboveAstSchema = z.object({
  type: z.literal('PRICE_ABOVE'),
  price: z.number({ message: 'Price is required' }).positive('Price must be greater than zero'),
  expiresAt: expiresAtSchema,
});

export const priceBelowAstSchema = z.object({
  type: z.literal('PRICE_BELOW'),
  price: z.number({ message: 'Price is required' }).positive('Price must be greater than zero'),
  expiresAt: expiresAtSchema,
});

export const rangeBoundAstSchema = z
  .object({
    type: z.literal('RANGE_BOUND'),
    lower: z.number({ message: 'Lower bound is required' }).positive('Lower bound must be greater than zero'),
    upper: z.number({ message: 'Upper bound is required' }).positive('Upper bound must be greater than zero'),
    expiresAt: expiresAtSchema,
  })
  .refine((value) => value.lower < value.upper, {
    message: 'Lower bound must be below the upper bound',
    path: ['upper'],
  });

export const ladderStepSchema = z.object({
  price: z.number({ message: 'Step price is required' }).positive('Step price must be greater than zero'),
  multiplier: z
    .number({ message: 'Step multiplier is required' })
    .positive('Step multiplier must be greater than zero'),
});

/**
 * A ladder of price levels, each paying more than the last.
 *
 * Both price and multiplier must strictly increase step to step: a ladder
 * where a farther, harder-to-reach level paid less than a nearer one would
 * be a market nobody would rationally hold past the first level.
 */
export const multiStepLadderAstSchema = z
  .object({
    type: z.literal('MULTI_STEP_LADDER'),
    steps: z.array(ladderStepSchema).min(2, 'A ladder needs at least 2 steps'),
    expiresAt: expiresAtSchema,
  })
  .superRefine((value, ctx) => {
    for (let index = 1; index < value.steps.length; index += 1) {
      if (value.steps[index].price <= value.steps[index - 1].price) {
        ctx.addIssue({
          code: 'custom',
          message: 'Step prices must strictly increase',
          path: ['steps', index, 'price'],
        });
      }

      if (value.steps[index].multiplier <= value.steps[index - 1].multiplier) {
        ctx.addIssue({
          code: 'custom',
          message: 'Step payout multipliers must strictly increase with price',
          path: ['steps', index, 'multiplier'],
        });
      }
    }
  });

export const conditionAstSchema = z.discriminatedUnion('type', [
  priceAboveAstSchema,
  priceBelowAstSchema,
  rangeBoundAstSchema,
  multiStepLadderAstSchema,
]);

export type ConditionAst = z.infer<typeof conditionAstSchema>;
export type ConditionAstType = ConditionAst['type'];
export type LadderStep = z.infer<typeof ladderStepSchema>;

export const CONDITION_AST_TYPES: readonly ConditionAstType[] = [
  'PRICE_ABOVE',
  'PRICE_BELOW',
  'RANGE_BOUND',
  'MULTI_STEP_LADDER',
] as const;

/**
 * Render a condition AST as a sentence, e.g. "Resolves YES if the price
 * stays between $60,000 and $65,000 until Oct 31, 2026."
 *
 * Kept to a single sentence per kind and free of string concatenation
 * ordering assumptions the message can't survive translation with, so a
 * future i18n pass can swap in a message-catalog lookup per `type` without
 * restructuring this function.
 */
export function explainConditionAst(ast: ConditionAst): string {
  const until = `until ${formatExpiry(ast.expiresAt)}`;

  switch (ast.type) {
    case 'PRICE_ABOVE':
      return `Resolves YES if the price rises above $${formatNumber(ast.price)}, ${until}.`;

    case 'PRICE_BELOW':
      return `Resolves YES if the price falls below $${formatNumber(ast.price)}, ${until}.`;

    case 'RANGE_BOUND':
      return `Resolves YES if the price stays between $${formatNumber(ast.lower)} and $${formatNumber(
        ast.upper,
      )}, ${until}.`;

    case 'MULTI_STEP_LADDER': {
      const steps = ast.steps
        .map((step) => `$${formatNumber(step.price)} pays ${formatNumber(step.multiplier)}x`)
        .join(', then ');

      return `Payout climbs in steps as the price crosses each level: ${steps}, ${until}.`;
    }
  }
}

export interface ConditionAstError {
  /** Dot-joined field path, e.g. "steps.1.price"; empty for a whole-value error. */
  path: string;
  message: string;
}

export interface ConditionAstValidation {
  valid: boolean;
  errors: ConditionAstError[];
  ast: ConditionAst | null;
  /** The natural-language sentence, present only when `valid` is true. */
  explanation: string | null;
}

/**
 * Validate an already-parsed value against the condition-AST grammar.
 *
 * Every issue zod finds is returned, not just the first, so a syntax editor
 * can point out every problem in one pass instead of a fix-and-recheck loop.
 */
export function validateConditionAst(raw: unknown): ConditionAstValidation {
  const result = conditionAstSchema.safeParse(raw);

  if (result.success) {
    return { valid: true, errors: [], ast: result.data, explanation: explainConditionAst(result.data) };
  }

  const errors: ConditionAstError[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

  return { valid: false, errors, ast: null, explanation: null };
}

/**
 * Validate raw JSON text, as typed into a live syntax editor.
 *
 * A malformed-JSON keystroke (an unclosed brace mid-edit) is expected while
 * typing, not exceptional, so it is reported the same way as a schema error
 * rather than thrown.
 */
export function validateConditionSyntax(rawInput: string): ConditionAstValidation {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawInput);
  } catch {
    return {
      valid: false,
      errors: [{ path: '', message: 'Invalid JSON syntax' }],
      ast: null,
      explanation: null,
    };
  }

  return validateConditionAst(parsed);
}
