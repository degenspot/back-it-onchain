import { BadgeKey } from './badge-definitions';

/**
 * Badge rule engine (BE-031) — strategy-pattern rule evaluation.
 *
 * `BadgesService.checkAndGrantBadges` currently evaluates badge eligibility
 * as a hardcoded if/else block. This module extracts that logic into a
 * `BadgeRule` strategy interface plus a `BadgeRuleEngine` that runs an
 * extensible list of rules against one `BadgeRuleContext`, so adding a new
 * badge is "add a rule object" rather than "add another if statement."
 *
 * `BADGE_RULES` below re-implements the 8 rules that
 * `BadgesService.checkAndGrantBadges` currently hardcodes, so this engine
 * is a behavior-preserving drop-in replacement for that block. Reaching
 * the issue's "25+ rules" would need additional queryable signals (e.g.
 * per-category accuracy, contrarian-outcome tracking) that don't exist in
 * the schema yet — this PR delivers the rule-engine architecture itself,
 * ready for those rules to be added one at a time as their signals become
 * available.
 *
 * Wiring `BadgesService.checkAndGrantBadges` to call this engine instead of
 * its inline if/else is a follow-up left for a maintainer, so as not to
 * risk the existing, already-tested service in this single-file change.
 */

export interface BadgeRuleContext {
  callCount: number;
  winsCount: number;
  totalStake: number;
  followerCount: number;
  streak: number;
  oracleSlayerCount: number;
}

export interface BadgeRule {
  key: BadgeKey;
  /** Pure predicate — no I/O, no side effects, given a fully-populated context. */
  evaluate(ctx: BadgeRuleContext): boolean;
}

export const BADGE_RULES: BadgeRule[] = [
  {
    key: BadgeKey.FIRST_CALL,
    evaluate: (ctx) => ctx.callCount >= 1,
  },
  {
    key: BadgeKey.FIVE_WINS,
    evaluate: (ctx) => ctx.winsCount >= 5,
  },
  {
    key: BadgeKey.TEN_WINS,
    evaluate: (ctx) => ctx.winsCount >= 10,
  },
  {
    key: BadgeKey.WHALE_STAKER,
    evaluate: (ctx) => ctx.totalStake >= 1000,
  },
  {
    key: BadgeKey.SOCIAL_BUTTERFLY,
    evaluate: (ctx) => ctx.followerCount >= 10,
  },
  {
    key: BadgeKey.STREAK,
    evaluate: (ctx) => ctx.streak >= 3,
  },
  {
    key: BadgeKey.HIGH_ROLLER,
    evaluate: (ctx) => ctx.totalStake >= 10_000,
  },
  {
    key: BadgeKey.ORACLE_SLAYER,
    evaluate: (ctx) => ctx.oracleSlayerCount >= 3,
  },
];

/**
 * Runs every registered rule against `ctx` and returns the badge keys whose
 * rule matched. Does not check for pre-existing grants or perform any I/O —
 * that idempotency/persistence concern stays in `BadgesService`, which is
 * what actually knows about the database.
 */
export class BadgeRuleEngine {
  constructor(private readonly rules: BadgeRule[] = BADGE_RULES) {}

  evaluate(ctx: BadgeRuleContext): BadgeKey[] {
    return this.rules.filter((rule) => rule.evaluate(ctx)).map((rule) => rule.key);
  }

  /** Registers an additional rule at runtime (e.g. a feature-flagged rule). */
  addRule(rule: BadgeRule): void {
    this.rules.push(rule);
  }
}
