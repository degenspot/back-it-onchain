import {
  createCallSchema,
  parsePrice,
  getTargetRule,
  toEndOfDay,
  TARGET_PRICE_RULES,
  DEFAULT_TARGET_RULE,
  STAKE_DECIMALS,
} from './create-call.schema';

describe('Create Call Validation Schema (Zod)', () => {
  // Helper to generate a future date string
  const getFutureDate = (): string => {
    const date = new Date();
    date.setDate(date.getDate() + 7); // 7 days from now
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  };

  const getPastDate = (): string => {
    const date = new Date();
    date.setDate(date.getDate() - 7); // 7 days ago
    return date.toISOString().split('T')[0];
  };

  const validBaseInput = {
    title: 'BTC will reach new ATH',
    thesis: 'Based on market trends and adoption',
    asset: 'BTC',
    conditionType: 'above' as const,
    target: '50000',
    deadline: getFutureDate(),
    stake: '100',
  };

  describe('Helper Functions', () => {
    describe('parsePrice', () => {
      it('should parse simple numeric strings', () => {
        expect(parsePrice('100')).toBe(100);
        expect(parsePrice('50.5')).toBe(50.5);
      });

      it('should remove dollar signs', () => {
        expect(parsePrice('$100')).toBe(100);
        expect(parsePrice('$50.50')).toBe(50.5);
      });

      it('should remove commas', () => {
        expect(parsePrice('1,000')).toBe(1000);
        expect(parsePrice('1,000,000')).toBe(1000000);
      });

      it('should remove spaces', () => {
        expect(parsePrice('1 000')).toBe(1000);
        expect(parsePrice('$ 50.50')).toBe(50.5);
      });

      it('should handle complex formatting', () => {
        expect(parsePrice('$1,000,000')).toBe(1000000);
        expect(parsePrice('$ 50,000.50')).toBe(50000.5);
      });

      it('should return NaN for invalid strings', () => {
        expect(parsePrice('abc')).toBeNaN();
        expect(parsePrice('')).toBeNaN();
      });
    });

    describe('getTargetRule', () => {
      it('should return specific rules for known assets', () => {
        expect(getTargetRule('ETH')).toEqual(TARGET_PRICE_RULES.ETH);
        expect(getTargetRule('BTC')).toEqual(TARGET_PRICE_RULES.BTC);
        expect(getTargetRule('SOL')).toEqual(TARGET_PRICE_RULES.SOL);
        expect(getTargetRule('XLM')).toEqual(TARGET_PRICE_RULES.XLM);
        expect(getTargetRule('USDC')).toEqual(TARGET_PRICE_RULES.USDC);
      });

      it('should be case-insensitive', () => {
        expect(getTargetRule('eth')).toEqual(TARGET_PRICE_RULES.ETH);
        expect(getTargetRule('Btc')).toEqual(TARGET_PRICE_RULES.BTC);
        expect(getTargetRule('Sol')).toEqual(TARGET_PRICE_RULES.SOL);
      });

      it('should handle whitespace', () => {
        expect(getTargetRule('  ETH  ')).toEqual(TARGET_PRICE_RULES.ETH);
        expect(getTargetRule(' btc ')).toEqual(TARGET_PRICE_RULES.BTC);
      });

      it('should return default rule for unknown assets', () => {
        expect(getTargetRule('UNKNOWN')).toEqual(DEFAULT_TARGET_RULE);
        expect(getTargetRule('DOGE')).toEqual(DEFAULT_TARGET_RULE);
        expect(getTargetRule('SHIB')).toEqual(DEFAULT_TARGET_RULE);
      });
    });

    describe('toEndOfDay', () => {
      it('should create a date at 23:59:59', () => {
        const date = toEndOfDay('2024-01-15');
        expect(date.getHours()).toBe(23);
        expect(date.getMinutes()).toBe(59);
        expect(date.getSeconds()).toBe(59);
      });

      it('should parse date string correctly', () => {
        const date = toEndOfDay('2024-06-30');
        expect(date.getFullYear()).toBe(2024);
        expect(date.getMonth()).toBe(5); // June is month 5 (0-indexed)
        expect(date.getDate()).toBe(30);
      });
    });
  });

  describe('Title Validation', () => {
    it('should accept valid titles (5-200 characters)', () => {
      const input = { ...validBaseInput, title: 'BTC price prediction' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject titles shorter than 5 characters', () => {
      const input = { ...validBaseInput, title: 'BTC' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('title');
        expect(result.error.issues[0].message).toContain('at least 5 characters');
      }
    });

    it('should reject titles longer than 200 characters', () => {
      const longTitle = 'A'.repeat(201);
      const input = { ...validBaseInput, title: longTitle };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('title');
        expect(result.error.issues[0].message).toContain('less than 200 characters');
      }
    });

    it('should trim whitespace from titles', () => {
      const input = { ...validBaseInput, title: '  BTC price prediction  ' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('BTC price prediction');
      }
    });

    it('should reject empty titles after trimming', () => {
      const input = { ...validBaseInput, title: '   ' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Thesis Validation', () => {
    it('should accept valid thesis', () => {
      const input = { ...validBaseInput, thesis: 'This is my analysis' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional thesis (undefined)', () => {
      const input = { ...validBaseInput, thesis: undefined };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject thesis longer than 5000 characters', () => {
      const longThesis = 'A'.repeat(5001);
      const input = { ...validBaseInput, thesis: longThesis };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('thesis');
        expect(result.error.issues[0].message).toContain('less than 5000 characters');
      }
    });

    it('should trim whitespace from thesis', () => {
      const input = { ...validBaseInput, thesis: '  My thesis  ' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.thesis).toBe('My thesis');
      }
    });
  });

  describe('Asset Validation', () => {
    it('should accept valid asset symbols', () => {
      const input = { ...validBaseInput, asset: 'ETH' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept alphanumeric asset symbols', () => {
      const input = { ...validBaseInput, asset: 'BTC2' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty asset', () => {
      const input = { ...validBaseInput, asset: '' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('asset');
      }
    });

    it('should reject asset symbols longer than 20 characters', () => {
      const input = { ...validBaseInput, asset: 'A'.repeat(21) };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('asset');
        expect(result.error.issues[0].message).toContain('less than 20 characters');
      }
    });

    it('should reject asset symbols with special characters', () => {
      const input = { ...validBaseInput, asset: 'BTC-USD' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('asset');
        expect(result.error.issues[0].message).toContain('alphanumeric');
      }
    });

    it('should reject asset symbols with spaces', () => {
      const input = { ...validBaseInput, asset: 'BTC USD' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should trim whitespace from asset', () => {
      const input = { ...validBaseInput, asset: '  ETH  ' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.asset).toBe('ETH');
      }
    });
  });

  describe('ConditionType Validation', () => {
    it('should accept "above" condition', () => {
      const input = { ...validBaseInput, conditionType: 'above' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept "below" condition', () => {
      const input = { ...validBaseInput, conditionType: 'below' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid condition types', () => {
      const input = { ...validBaseInput, conditionType: 'equals' as any };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('conditionType');
        expect(result.error.issues[0].message).toContain('above" or "below');
      }
    });

    it('should reject undefined conditionType', () => {
      const input = { ...validBaseInput, conditionType: undefined as any };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Target Price Validation', () => {
    it('should accept valid target prices', () => {
      const input = { ...validBaseInput, target: '50000' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept target prices with decimals', () => {
      const input = { ...validBaseInput, target: '50000.50' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept target prices with dollar signs', () => {
      const input = { ...validBaseInput, target: '$50,000' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty target', () => {
      const input = { ...validBaseInput, target: '' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('target');
        expect(result.error.issues[0].message).toContain('required');
      }
    });

    it('should reject non-numeric target prices', () => {
      const input = { ...validBaseInput, target: 'abc' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('target');
        expect(result.error.issues[0].message).toContain('valid number');
      }
    });

    it('should reject target prices below minimum for known assets (BTC)', () => {
      const input = { ...validBaseInput, asset: 'BTC', target: '500' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('target');
        expect(result.error.issues[0].message).toContain('between');
        expect(result.error.issues[0].message).toContain('BTC');
      }
    });

    it('should reject target prices above maximum for known assets (ETH)', () => {
      const input = { ...validBaseInput, asset: 'ETH', target: '200000' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('target');
        expect(result.error.issues[0].message).toContain('between');
        expect(result.error.issues[0].message).toContain('ETH');
      }
    });

    it('should accept target at minimum boundary', () => {
      const input = { ...validBaseInput, asset: 'BTC', target: '1000' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept target at maximum boundary', () => {
      const input = { ...validBaseInput, asset: 'BTC', target: '250000' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should use default rules for unknown assets', () => {
      const input = { ...validBaseInput, asset: 'DOGE', target: '0.5' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('Deadline Validation', () => {
    it('should accept future dates', () => {
      const input = { ...validBaseInput, deadline: getFutureDate() };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject past dates', () => {
      const input = { ...validBaseInput, deadline: getPastDate() };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('deadline');
        expect(result.error.issues[0].message).toContain('future');
      }
    });

    it('should reject empty deadline', () => {
      const input = { ...validBaseInput, deadline: '' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('deadline');
        expect(result.error.issues[0].message).toContain('required');
      }
    });

    it('should reject invalid date formats', () => {
      const input = { ...validBaseInput, deadline: 'not-a-date' };
      const result = createCallSchema.safeParse(input);
      // This might be in the past or invalid, either way should fail
      expect(result.success).toBe(false);
    });
  });

  describe('Stake Validation', () => {
    it('should accept valid stake amounts', () => {
      const input = { ...validBaseInput, stake: '100' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept stake amounts with decimals', () => {
      const input = { ...validBaseInput, stake: '100.50' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject zero stake', () => {
      const input = { ...validBaseInput, stake: '0' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('stake');
        expect(result.error.issues[0].message).toContain('positive');
      }
    });

    it('should reject negative stake', () => {
      const input = { ...validBaseInput, stake: '-50' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('stake');
        expect(result.error.issues[0].message).toContain('positive');
      }
    });

    it('should reject non-numeric stake', () => {
      const input = { ...validBaseInput, stake: 'abc' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('stake');
        expect(result.error.issues[0].message).toContain('positive');
      }
    });

    it('should reject empty stake', () => {
      const input = { ...validBaseInput, stake: '' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept stake with up to 18 decimal places', () => {
      const input = { ...validBaseInput, stake: '100.123456789012345678' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject stake with more than 18 decimal places', () => {
      const input = { ...validBaseInput, stake: '100.1234567890123456789' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('stake');
        expect(result.error.issues[0].message).toContain('18 decimal places');
      }
    });

    it('should trim whitespace from stake', () => {
      const input = { ...validBaseInput, stake: '  100  ' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('Strict Mode Validation', () => {
    it('should reject unknown fields', () => {
      const input = {
        ...validBaseInput,
        unknownField: 'should not be here',
      } as any;
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Unrecognized key');
      }
    });

    it('should reject with multiple unknown fields', () => {
      const input = {
        ...validBaseInput,
        field1: 'value1',
        field2: 'value2',
      } as any;
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Complete Valid Inputs', () => {
    it('should accept minimal valid input (without optional thesis)', () => {
      const input = {
        title: 'BTC prediction',
        asset: 'BTC',
        conditionType: 'above' as const,
        target: '50000',
        deadline: getFutureDate(),
        stake: '100',
      };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept full valid input with thesis', () => {
      const input = {
        title: 'BTC will reach new ATH',
        thesis: 'Based on market analysis',
        asset: 'BTC',
        conditionType: 'below' as const,
        target: '40000',
        deadline: getFutureDate(),
        stake: '50.5',
      };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should correctly parse and transform all fields', () => {
      const input = {
        title: '  ETH Price Prediction  ',
        thesis: '  My analysis  ',
        asset: '  ETH  ',
        conditionType: 'above' as const,
        target: ' $5,000 ',
        deadline: getFutureDate(),
        stake: '  100.50  ',
      };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('ETH Price Prediction');
        expect(result.data.thesis).toBe('My analysis');
        expect(result.data.asset).toBe('ETH');
        expect(result.data.conditionType).toBe('above');
        expect(result.data.target).toBe('$5,000');
        expect(result.data.stake).toBe('100.50');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small valid stake amounts', () => {
      const input = { ...validBaseInput, stake: '0.000000000000000001' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should handle very large target prices for unknown assets', () => {
      const input = { ...validBaseInput, asset: 'CUSTOM', target: '999999999' };
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should handle boundary title lengths', () => {
      const input5Chars = { ...validBaseInput, title: '12345' };
      expect(createCallSchema.safeParse(input5Chars).success).toBe(true);

      const input200Chars = { ...validBaseInput, title: 'A'.repeat(200) };
      expect(createCallSchema.safeParse(input200Chars).success).toBe(true);
    });

    it('should handle different asset case variations', () => {
      const inputLower = { ...validBaseInput, asset: 'btc' };
      expect(createCallSchema.safeParse(inputLower).success).toBe(true);

      const inputMixed = { ...validBaseInput, asset: 'BtC' };
      expect(createCallSchema.safeParse(inputMixed).success).toBe(true);
    });
  });

  describe('Multiple Validation Errors', () => {
    it('should return multiple errors for invalid input', () => {
      const input = {
        title: 'AB', // Too short
        asset: '', // Empty
        conditionType: 'invalid', // Invalid enum
        target: 'abc', // Not a number
        deadline: getPastDate(), // Past date
        stake: '-10', // Negative
      } as any;
      const result = createCallSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(1);
      }
    });
  });
});
