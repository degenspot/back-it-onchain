import { BadgeRuleEngine, BadgeRuleContext, BadgeRule } from './badge-rule-engine';
import { BadgeKey } from './badge-definitions';

function ctx(overrides: Partial<BadgeRuleContext> = {}): BadgeRuleContext {
  return {
    callCount: 0,
    winsCount: 0,
    totalStake: 0,
    followerCount: 0,
    streak: 0,
    oracleSlayerCount: 0,
    ...overrides,
  };
}

describe('BadgeRuleEngine', () => {
  it('returns no badges for a fully-zero context', () => {
    const engine = new BadgeRuleEngine();
    expect(engine.evaluate(ctx())).toEqual([]);
  });

  it('matches FIRST_CALL once callCount reaches 1', () => {
    const engine = new BadgeRuleEngine();
    expect(engine.evaluate(ctx({ callCount: 1 }))).toContain(BadgeKey.FIRST_CALL);
  });

  it('matches multiple badges simultaneously when several thresholds are met', () => {
    const engine = new BadgeRuleEngine();
    const earned = engine.evaluate(
      ctx({ callCount: 1, winsCount: 10, totalStake: 10_000, streak: 3 })
    );
    expect(earned).toEqual(
      expect.arrayContaining([
        BadgeKey.FIRST_CALL,
        BadgeKey.FIVE_WINS,
        BadgeKey.TEN_WINS,
        BadgeKey.WHALE_STAKER,
        BadgeKey.HIGH_ROLLER,
        BadgeKey.STREAK,
      ])
    );
  });

  it('respects each threshold\'s exact boundary (matches at, not before)', () => {
    const engine = new BadgeRuleEngine();
    expect(engine.evaluate(ctx({ winsCount: 4 }))).not.toContain(BadgeKey.FIVE_WINS);
    expect(engine.evaluate(ctx({ winsCount: 5 }))).toContain(BadgeKey.FIVE_WINS);
  });

  it('reproduces the same 8 outcomes as BadgesService.checkAndGrantBadges for a representative context', () => {
    // Mirrors the inline if/else this engine is meant to replace.
    const engine = new BadgeRuleEngine();
    const sample = ctx({
      callCount: 1,
      winsCount: 5,
      totalStake: 1_500,
      followerCount: 12,
      streak: 3,
      oracleSlayerCount: 3,
    });
    const earned = engine.evaluate(sample);
    expect(earned.sort()).toEqual(
      [
        BadgeKey.FIRST_CALL,
        BadgeKey.FIVE_WINS,
        BadgeKey.WHALE_STAKER,
        BadgeKey.SOCIAL_BUTTERFLY,
        BadgeKey.STREAK,
        BadgeKey.ORACLE_SLAYER,
      ].sort()
    );
  });

  it('supports registering an additional rule at runtime via addRule', () => {
    const engine = new BadgeRuleEngine([]);
    const customRule: BadgeRule = {
      key: BadgeKey.STREAK,
      evaluate: (c) => c.streak >= 100,
    };
    engine.addRule(customRule);

    expect(engine.evaluate(ctx({ streak: 50 }))).toEqual([]);
    expect(engine.evaluate(ctx({ streak: 100 }))).toEqual([BadgeKey.STREAK]);
  });

  it('accepts a custom rule set via the constructor, independent of BADGE_RULES', () => {
    const onlyFirstCall: BadgeRule = {
      key: BadgeKey.FIRST_CALL,
      evaluate: (c) => c.callCount >= 1,
    };
    const engine = new BadgeRuleEngine([onlyFirstCall]);

    const earned = engine.evaluate(ctx({ callCount: 1, winsCount: 999, totalStake: 999_999 }));
    expect(earned).toEqual([BadgeKey.FIRST_CALL]);
  });
});
