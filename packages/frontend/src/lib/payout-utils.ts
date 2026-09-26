/**
 * payout-utils.ts
 *
 * Frontend-only pull-payout preview maths for the withdraw/claim flow. Mirrors
 * the on-chain settlement rule: a winner's payout is their proportional share
 * of the total pool (winning + losing stakes), minus the platform fee.
 */

export interface PayoutInput {
  /** The claimant's stake on the winning outcome (USDC). */
  userStake: number;
  /** Total stake on the winning outcome (USDC). */
  winningPoolTotal: number;
  /** Total stake on the losing outcome(s) (USDC). */
  losingPoolTotal: number;
  /** Platform fee in basis points (e.g. 200 = 2%). */
  feeBps?: number;
}

export interface PayoutPreview {
  /** Proportional share of the total pool before fees. */
  gross: number;
  /** Platform fee deducted from gross. */
  fee: number;
  /** Amount actually claimable after fees. */
  net: number;
  /** Net minus original stake (pure winnings). */
  profit: number;
  /** Claimant's fractional share of the winning pool (0–1). */
  share: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computePayout({
  userStake,
  winningPoolTotal,
  losingPoolTotal,
  feeBps = 0,
}: PayoutInput): PayoutPreview {
  const stake = Math.max(0, userStake);
  const winPool = Math.max(0, winningPoolTotal);
  const losePool = Math.max(0, losingPoolTotal);

  if (winPool === 0 || stake === 0) {
    return { gross: 0, fee: 0, net: 0, profit: -stake, share: 0 };
  }

  const share = Math.min(stake / winPool, 1);
  const totalPool = winPool + losePool;
  const gross = share * totalPool;
  const fee = gross * (Math.max(0, feeBps) / 10_000);
  const net = gross - fee;

  return {
    gross: round2(gross),
    fee: round2(fee),
    net: round2(net),
    profit: round2(net - stake),
    share: Math.round(share * 10_000) / 10_000,
  };
}

/** Build a chain-appropriate explorer URL for a transaction hash. */
export function explorerTxUrl(
  chain: 'base' | 'stellar',
  txHash: string,
): string {
  return chain === 'base'
    ? `https://basescan.org/tx/${txHash}`
    : `https://stellar.expert/explorer/public/tx/${txHash}`;
}

// ── Position sizing & profit projection (FE-006) ───────────────────────────

export interface OddsPreview {
  /** Implied probability of this outcome winning, from the pool split (0-1). */
  impliedProbability: number;
  /** Decimal odds: how many times a stake returns pre-fee if this side wins. */
  decimalOdds: number;
}

/**
 * Parimutuel odds implied by the current pool split.
 *
 * An empty pool (nobody has staked either side yet) has no information to
 * imply odds from, so it is treated as a coin flip rather than a divide by
 * zero — the honest starting point before either side has any weight.
 */
export function computeParimutuelOdds({
  winningPoolTotal,
  losingPoolTotal,
}: {
  winningPoolTotal: number;
  losingPoolTotal: number;
}): OddsPreview {
  const winPool = Math.max(0, winningPoolTotal);
  const losePool = Math.max(0, losingPoolTotal);
  const total = winPool + losePool;

  if (total <= 0) return { impliedProbability: 0.5, decimalOdds: 2 };
  if (winPool <= 0) return { impliedProbability: 0, decimalOdds: 0 };

  return {
    impliedProbability: winPool / total,
    decimalOdds: total / winPool,
  };
}

/**
 * The win probability at which a bet with this payout multiplier breaks even
 * in expectation: `p * net - stake = 0`, so `p = stake / net = 1 / multiplier`.
 *
 * A multiplier of 0 (total loss on every outcome) can never break even at any
 * probability, so it is reported as 1 (impossible) rather than `Infinity`.
 */
export function breakEvenProbability(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 1;

  return Math.min(1, 1 / multiplier);
}

export interface PositionSizingInput {
  /** The stake being considered, not yet placed. */
  stakeAmount: number;
  /** Stake already on this outcome, before the candidate stake is added. */
  existingWinningPoolTotal: number;
  /** Stake on the opposing outcome(s). */
  existingLosingPoolTotal: number;
  protocolFeeBps?: number;
  /** Additional dynamic fee applied during high-volatility periods. */
  surgeFeeBps?: number;
}

export interface PositionSizingResult {
  payout: PayoutPreview;
  odds: OddsPreview;
  breakEvenProbability: number;
  /** Net payout divided by stake: how many times the stake comes back if it wins. */
  multiplier: number;
}

/**
 * Project the payout for a stake that has not been placed yet.
 *
 * `computePayout` assumes its `winningPoolTotal` already includes the
 * claimant's stake, which is true post-hoc at withdrawal time but not here:
 * a position-sizing tool is used *before* committing, so the candidate stake
 * is added to the existing pool first.
 */
export function projectPosition(input: PositionSizingInput): PositionSizingResult {
  const stake = Math.max(0, input.stakeAmount);
  const winningPoolTotal = Math.max(0, input.existingWinningPoolTotal) + stake;
  const losingPoolTotal = Math.max(0, input.existingLosingPoolTotal);
  const feeBps = Math.max(0, input.protocolFeeBps ?? 0) + Math.max(0, input.surgeFeeBps ?? 0);

  const payout = computePayout({ userStake: stake, winningPoolTotal, losingPoolTotal, feeBps });
  const odds = computeParimutuelOdds({ winningPoolTotal, losingPoolTotal });
  const multiplier = stake > 0 ? payout.net / stake : 0;

  return { payout, odds, breakEvenProbability: breakEvenProbability(multiplier), multiplier };
}

export interface PoolScenario {
  id: string;
  label: string;
  /** Applied to the existing winning pool before the candidate stake is added. */
  winningPoolMultiplier?: number;
  winningPoolDelta?: number;
  /** Applied to the existing losing pool. */
  losingPoolMultiplier?: number;
  losingPoolDelta?: number;
}

export interface ScenarioResult extends PositionSizingResult {
  scenario: PoolScenario;
}

/**
 * Project the same candidate stake across several future pool states.
 *
 * Multipliers and deltas are applied to the *existing* pools, before the
 * candidate stake is added back in by `projectPosition` — a "pool doubles"
 * scenario should double what is already staked, not double a number that
 * already includes the stake being sized.
 */
export function projectScenarios(
  base: Omit<PositionSizingInput, 'existingWinningPoolTotal' | 'existingLosingPoolTotal'> & {
    existingWinningPoolTotal: number;
    existingLosingPoolTotal: number;
  },
  scenarios: PoolScenario[],
): ScenarioResult[] {
  return scenarios.map((scenario) => {
    const existingWinningPoolTotal = Math.max(
      0,
      base.existingWinningPoolTotal * (scenario.winningPoolMultiplier ?? 1) +
        (scenario.winningPoolDelta ?? 0),
    );
    const existingLosingPoolTotal = Math.max(
      0,
      base.existingLosingPoolTotal * (scenario.losingPoolMultiplier ?? 1) + (scenario.losingPoolDelta ?? 0),
    );

    const result = projectPosition({ ...base, existingWinningPoolTotal, existingLosingPoolTotal });

    return { ...result, scenario };
  });
}

/**
 * A representative scenario set covering the cases callers most often want
 * to see side by side, including the edge cases the matrix must handle
 * cleanly: no opposing stake at all, and this outcome dominating entirely.
 */
export function defaultScenarios(): PoolScenario[] {
  return [
    { id: 'current', label: 'Current pool' },
    { id: 'pool_doubles', label: 'Pool doubles', winningPoolMultiplier: 2, losingPoolMultiplier: 2 },
    { id: 'opposing_plus_1000', label: 'Opposing stake +$1,000', losingPoolDelta: 1_000 },
    { id: 'dominant_outcome', label: 'No opposing stake', losingPoolMultiplier: 0, losingPoolDelta: 0 },
  ];
}
