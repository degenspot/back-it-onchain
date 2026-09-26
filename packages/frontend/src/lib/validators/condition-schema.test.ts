import { describe, it, expect } from 'vitest';
import {
  CONDITION_AST_TYPES,
  MIN_LEAD_TIME_MS,
  conditionAstSchema,
  explainConditionAst,
  validateConditionAst,
  validateConditionSyntax,
  type ConditionAst,
} from './condition-schema';

const FAR_FUTURE = Date.now() + MIN_LEAD_TIME_MS + 24 * 60 * 60 * 1000;
const TOO_SOON = Date.now() + 60 * 1000;

describe('conditionAstSchema — PRICE_ABOVE / PRICE_BELOW', () => {
  it('accepts a valid PRICE_ABOVE condition', () => {
    const result = conditionAstSchema.safeParse({ type: 'PRICE_ABOVE', price: 100, expiresAt: FAR_FUTURE });

    expect(result.success).toBe(true);
  });

  it('accepts a valid PRICE_BELOW condition', () => {
    const result = conditionAstSchema.safeParse({ type: 'PRICE_BELOW', price: 100, expiresAt: FAR_FUTURE });

    expect(result.success).toBe(true);
  });

  it('rejects a non-positive price', () => {
    const result = conditionAstSchema.safeParse({ type: 'PRICE_ABOVE', price: 0, expiresAt: FAR_FUTURE });

    expect(result.success).toBe(false);
  });

  it('rejects an expiry less than 1 hour from now', () => {
    const result = conditionAstSchema.safeParse({ type: 'PRICE_ABOVE', price: 100, expiresAt: TOO_SOON });

    expect(result.success).toBe(false);
  });

  it('rejects an expiry in the past', () => {
    const result = conditionAstSchema.safeParse({
      type: 'PRICE_BELOW',
      price: 100,
      expiresAt: Date.now() - 1000,
    });

    expect(result.success).toBe(false);
  });
});

describe('conditionAstSchema — RANGE_BOUND', () => {
  it('accepts a valid range with lower below upper', () => {
    const result = conditionAstSchema.safeParse({
      type: 'RANGE_BOUND',
      lower: 60_000,
      upper: 65_000,
      expiresAt: FAR_FUTURE,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a range where lower is not below upper', () => {
    const equal = conditionAstSchema.safeParse({
      type: 'RANGE_BOUND',
      lower: 100,
      upper: 100,
      expiresAt: FAR_FUTURE,
    });
    const inverted = conditionAstSchema.safeParse({
      type: 'RANGE_BOUND',
      lower: 110,
      upper: 100,
      expiresAt: FAR_FUTURE,
    });

    expect(equal.success).toBe(false);
    expect(inverted.success).toBe(false);
  });

  it('rejects a non-positive bound', () => {
    const result = conditionAstSchema.safeParse({
      type: 'RANGE_BOUND',
      lower: -10,
      upper: 100,
      expiresAt: FAR_FUTURE,
    });

    expect(result.success).toBe(false);
  });
});

describe('conditionAstSchema — MULTI_STEP_LADDER', () => {
  const validLadder = {
    type: 'MULTI_STEP_LADDER' as const,
    steps: [
      { price: 100, multiplier: 2 },
      { price: 150, multiplier: 5 },
      { price: 200, multiplier: 10 },
    ],
    expiresAt: FAR_FUTURE,
  };

  it('accepts a ladder with strictly increasing price and multiplier', () => {
    expect(conditionAstSchema.safeParse(validLadder).success).toBe(true);
  });

  it('rejects fewer than 2 steps', () => {
    const result = conditionAstSchema.safeParse({ ...validLadder, steps: [{ price: 100, multiplier: 2 }] });

    expect(result.success).toBe(false);
  });

  it('rejects a step whose price does not strictly increase', () => {
    const result = conditionAstSchema.safeParse({
      ...validLadder,
      steps: [
        { price: 100, multiplier: 2 },
        { price: 100, multiplier: 5 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a step whose multiplier does not strictly increase', () => {
    const result = conditionAstSchema.safeParse({
      ...validLadder,
      steps: [
        { price: 100, multiplier: 5 },
        { price: 150, multiplier: 5 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-positive step price or multiplier', () => {
    const badPrice = conditionAstSchema.safeParse({
      ...validLadder,
      steps: [
        { price: 0, multiplier: 2 },
        { price: 150, multiplier: 5 },
      ],
    });
    const badMultiplier = conditionAstSchema.safeParse({
      ...validLadder,
      steps: [
        { price: 100, multiplier: 0 },
        { price: 150, multiplier: 5 },
      ],
    });

    expect(badPrice.success).toBe(false);
    expect(badMultiplier.success).toBe(false);
  });
});

describe('CONDITION_AST_TYPES', () => {
  it('lists all four supported types', () => {
    expect(CONDITION_AST_TYPES).toEqual(['PRICE_ABOVE', 'PRICE_BELOW', 'RANGE_BOUND', 'MULTI_STEP_LADDER']);
  });
});

describe('explainConditionAst', () => {
  it('describes PRICE_ABOVE in plain language', () => {
    const ast: ConditionAst = { type: 'PRICE_ABOVE', price: 65_000, expiresAt: FAR_FUTURE };

    expect(explainConditionAst(ast)).toMatch(/rises above \$65,000/);
  });

  it('describes PRICE_BELOW in plain language', () => {
    const ast: ConditionAst = { type: 'PRICE_BELOW', price: 55_000, expiresAt: FAR_FUTURE };

    expect(explainConditionAst(ast)).toMatch(/falls below \$55,000/);
  });

  it('describes RANGE_BOUND with both bounds', () => {
    const ast: ConditionAst = { type: 'RANGE_BOUND', lower: 60_000, upper: 65_000, expiresAt: FAR_FUTURE };

    expect(explainConditionAst(ast)).toMatch(/between \$60,000 and \$65,000/);
  });

  it('describes MULTI_STEP_LADDER listing every step and its multiplier', () => {
    const ast: ConditionAst = {
      type: 'MULTI_STEP_LADDER',
      steps: [
        { price: 100, multiplier: 2 },
        { price: 150, multiplier: 5 },
      ],
      expiresAt: FAR_FUTURE,
    };
    const explanation = explainConditionAst(ast);

    expect(explanation).toMatch(/\$100 pays 2x/);
    expect(explanation).toMatch(/\$150 pays 5x/);
  });

  it('includes a formatted expiry date in every explanation', () => {
    const ast: ConditionAst = { type: 'PRICE_ABOVE', price: 100, expiresAt: FAR_FUTURE };

    expect(explainConditionAst(ast)).toMatch(/until [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  });
});

describe('validateConditionAst', () => {
  it('returns valid: true with an ast and explanation for a well-formed condition', () => {
    const result = validateConditionAst({ type: 'PRICE_ABOVE', price: 100, expiresAt: FAR_FUTURE });

    expect(result.valid).toBe(true);
    expect(result.ast).not.toBeNull();
    expect(result.explanation).toMatch(/rises above/);
    expect(result.errors).toEqual([]);
  });

  it('returns every issue, not just the first, for a multiply-invalid value', () => {
    const result = validateConditionAst({ type: 'RANGE_BOUND', lower: -5, upper: -1, expiresAt: TOO_SOON });

    expect(result.valid).toBe(false);
    expect(result.ast).toBeNull();
    expect(result.explanation).toBeNull();
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('reports a path for a nested ladder-step error', () => {
    const result = validateConditionAst({
      type: 'MULTI_STEP_LADDER',
      steps: [
        { price: 100, multiplier: 2 },
        { price: 100, multiplier: 5 },
      ],
      expiresAt: FAR_FUTURE,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path === 'steps.1.price')).toBe(true);
  });

  it('rejects a value with no recognizable type', () => {
    const result = validateConditionAst({ type: 'NOT_A_REAL_KIND' });

    expect(result.valid).toBe(false);
  });
});

describe('validateConditionSyntax', () => {
  it('parses valid JSON text into a valid result', () => {
    const raw = JSON.stringify({ type: 'PRICE_ABOVE', price: 100, expiresAt: FAR_FUTURE });
    const result = validateConditionSyntax(raw);

    expect(result.valid).toBe(true);
    expect(result.explanation).toMatch(/rises above/);
  });

  it('reports a syntax error for malformed JSON without throwing', () => {
    const result = validateConditionSyntax('{ "type": "PRICE_ABOVE", price: }');

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toMatch(/Invalid JSON/);
  });

  it('reports schema errors for syntactically valid JSON with an invalid shape', () => {
    const result = validateConditionSyntax(JSON.stringify({ type: 'RANGE_BOUND', lower: 100, upper: 50 }));

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
