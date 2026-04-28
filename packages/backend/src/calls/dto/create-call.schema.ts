import { z } from 'zod';

// Constants for validation rules
export const CONDITION_TYPES = ['above', 'below'] as const;

export const TARGET_PRICE_RULES: Record<string, { min: number; max: number; decimals: number }> = {
  ETH: { min: 100, max: 100000, decimals: 2 },
  BTC: { min: 1000, max: 250000, decimals: 2 },
  SOL: { min: 1, max: 5000, decimals: 3 },
  XLM: { min: 0.01, max: 50, decimals: 4 },
  USDC: { min: 0.95, max: 1.05, decimals: 4 },
};

export const DEFAULT_TARGET_RULE = { min: 0.000001, max: 1000000000, decimals: 8 };
export const STAKE_DECIMALS = 18;

// Helper functions
export const parsePrice = (value: string): number =>
  Number.parseFloat(value.replace(/[$,\s]/g, ''));

export const getTargetRule = (asset: string) =>
  TARGET_PRICE_RULES[asset.trim().toUpperCase()] ?? DEFAULT_TARGET_RULE;

export const toEndOfDay = (dateInput: string): Date =>
  new Date(`${dateInput}T23:59:59`);

// Zod schema for call creation
export const createCallSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(5, 'Title is required and must be at least 5 characters')
      .max(200, 'Title must be less than 200 characters'),
    thesis: z.string().trim().max(5000, 'Thesis must be less than 5000 characters').optional(),
    asset: z
      .string()
      .trim()
      .min(1, 'Asset is required')
      .max(20, 'Asset symbol must be less than 20 characters')
      .regex(/^[A-Za-z0-9]+$/, 'Asset must contain only alphanumeric characters'),
    conditionType: z.enum(CONDITION_TYPES, {
      message: 'Condition type must be either "above" or "below"',
    }),
    target: z.string().trim().min(1, 'Target price is required'),
    deadline: z
      .string()
      .min(1, 'End date is required')
      .refine((value) => {
        const date = toEndOfDay(value);
        return date > new Date();
      }, {
        message: 'End date must be in the future',
      }),
    stake: z
      .string()
      .trim()
      .refine((value) => {
        const num = Number.parseFloat(value);
        return Number.isFinite(num) && num > 0;
      }, {
        message: 'Stake amount must be a positive number',
      }),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Validate target price based on asset rules
    const rule = getTargetRule(data.asset);
    const targetNumber = parsePrice(data.target);

    if (!Number.isFinite(targetNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: 'Target price must be a valid number',
      });
      return;
    }

    if (targetNumber < rule.min || targetNumber > rule.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: `Target price for ${data.asset.toUpperCase()} must be between $${rule.min.toLocaleString(undefined, {
          maximumFractionDigits: rule.decimals,
        })} and $${rule.max.toLocaleString(undefined, {
          maximumFractionDigits: rule.decimals,
        })}`,
      });
    }

    // Validate stake decimal precision
    const stakeNumber = Number.parseFloat(data.stake);
    if (!Number.isFinite(stakeNumber) || stakeNumber <= 0) {
      return;
    }

    try {
      const stakeParts = data.stake.split('.');
      if (stakeParts.length > 1 && stakeParts[1].length > STAKE_DECIMALS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stake'],
          message: `Stake amount cannot have more than ${STAKE_DECIMALS} decimal places`,
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stake'],
        message: 'Stake amount has invalid format',
      });
    }
  });

// Type inference from schema
export type CreateCallInput = z.infer<typeof createCallSchema>;
