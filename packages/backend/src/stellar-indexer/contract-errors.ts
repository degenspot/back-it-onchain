/**
 * Wire-code -> meaning map for the Soroban `ContractError` enum (BE-006).
 *
 * `#[contracterror]` emits each variant as its `u32` discriminant, so a failed
 * transaction carries only a number. This is the lookup that turns that number
 * back into something a developer — or a user-facing notification — can read.
 *
 * Source of truth: `packages/contracts-stellar/governance/src/errors.rs`.
 * `contract-errors.spec.ts` parses that file and fails if a variant is added
 * there without being added here, so the two cannot drift silently.
 */

export interface ContractErrorInfo {
  /** Rust variant name, e.g. `CallNotFound`. */
  readonly name: string;
  /** Message safe to surface to a user. */
  readonly message: string;
}

export const CONTRACT_ERRORS: Readonly<Record<number, ContractErrorInfo>> = {
  // Authorization & access control
  1: {
    name: 'Unauthorized',
    message: 'You are not authorized to perform this action.',
  },
  2: {
    name: 'ContractPaused',
    message: 'The contract is paused and cannot accept writes right now.',
  },
  3: {
    name: 'AdminNotSet',
    message: 'No admin is configured on the contract.',
  },

  // Call lifecycle
  4: { name: 'CallEnded', message: 'This call has already ended.' },
  5: { name: 'CallSettled', message: 'This call has already been settled.' },
  6: {
    name: 'CallNotEnded',
    message: 'This call has not ended yet, so it cannot be finalized.',
  },
  7: { name: 'CallNotSettled', message: 'This call has not been settled yet.' },
  8: {
    name: 'AlreadyInitialized',
    message: 'The contract has already been initialized.',
  },
  9: { name: 'CallNotFound', message: 'That call does not exist.' },

  // Validation
  10: {
    name: 'InvalidAmount',
    message: 'The amount must be greater than zero.',
  },
  11: {
    name: 'InvalidEndTime',
    message: 'The end time must be in the future.',
  },
  12: {
    name: 'InvalidOutcomeIndex',
    message: 'That outcome does not exist on this call.',
  },
  13: {
    name: 'InvalidWinningOutcome',
    message: 'The winning outcome index is invalid.',
  },
  14: {
    name: 'TooFewOutcomes',
    message: 'A call needs at least two outcomes.',
  },
  15: {
    name: 'TooManyOutcomes',
    message: 'A call cannot have more than 32 outcomes.',
  },
  16: {
    name: 'NoFeesToDistribute',
    message: 'There are no fees available to distribute.',
  },
  17: { name: 'ZeroWeight', message: 'Total governance weight is zero.' },
  18: {
    name: 'CallNotSettledForArchive',
    message: 'The call must be settled before it can be archived.',
  },

  // User stake & withdrawal
  19: { name: 'NoStakeFound', message: 'You have no stake on that outcome.' },
  20: {
    name: 'NotOnWinningSide',
    message: 'You did not stake on the winning outcome.',
  },
  21: { name: 'NothingToWithdraw', message: 'There is nothing to withdraw.' },

  // Token whitelist
  22: {
    name: 'TokenNotWhitelisted',
    message: 'That token is not whitelisted for staking.',
  },
  23: {
    name: 'NotAuthorizedStaker',
    message: 'You are not an authorized staker.',
  },
  24: {
    name: 'NoTokenProposal',
    message: 'No proposal exists for that token.',
  },

  // Oracle & outcome manager
  25: {
    name: 'OracleNotAuthorized',
    message: 'This oracle is not authorized to submit outcomes.',
  },
  26: {
    name: 'OracleBondRequired',
    message: 'The oracle must deposit a bond first.',
  },
  27: {
    name: 'OracleAlreadyVoted',
    message: 'This oracle has already voted on the call.',
  },
  28: {
    name: 'CallOutcomeMissing',
    message: 'The call outcome has not been set.',
  },
  29: {
    name: 'CallAlreadySlashed',
    message: 'This call has already been slashed after an overturn.',
  },
  30: {
    name: 'FeeConfigNotSet',
    message: 'Fee configuration has not been set.',
  },
  31: {
    name: 'OracleBondTokenNotSet',
    message: 'The oracle bond token is not configured.',
  },
  32: {
    name: 'ZeroDenominator',
    message: 'The quorum denominator cannot be zero.',
  },
  33: {
    name: 'InvalidQuorumNumerator',
    message: 'The quorum numerator is invalid.',
  },
  34: {
    name: 'FeeBasisPointsExceeded',
    message: 'Fee basis points exceed the maximum of 10000.',
  },

  // Withdrawal & payout
  35: {
    name: 'AlreadyWithdrawn',
    message: 'You have already withdrawn this payout.',
  },

  // Cross-chain oracle
  36: {
    name: 'HashLockVerificationFailed',
    message: 'Cross-chain hash lock verification failed.',
  },
  37: {
    name: 'NoCrossChainReference',
    message: 'No cross-chain reference exists for this call.',
  },

  // Arithmetic
  38: { name: 'ArithmeticOverflow', message: 'The operation overflowed.' },

  // Binary market view
  39: {
    name: 'InvalidOutcomeCount',
    message: 'A binary market view requires exactly two pools.',
  },

  // Fee configuration
  40: {
    name: 'InvalidFeeConfig',
    message:
      'Fee basis points are outside the allowed range, or the treasury is invalid.',
  },
  41: {
    name: 'InvalidWeights',
    message: 'The weights vector does not match the recipients.',
  },

  // Ownership
  42: {
    name: 'OwnerNotSet',
    message: 'The contract has no owner set and is uninitialized.',
  },
  43: {
    name: 'NoPendingOwner',
    message: 'There is no pending ownership transfer.',
  },
  44: {
    name: 'OwnershipTransferTooEarly',
    message: 'The ownership transfer delay has not elapsed yet.',
  },
  45: { name: 'InvalidOwner', message: 'The proposed owner is invalid.' },
  46: {
    name: 'OwnerSourceNotSet',
    message:
      'The contract this treasury mirrors its owner from is not configured.',
  },

  // Liquidity
  47: {
    name: 'InsufficientShares',
    message: 'You tried to remove more shares than you hold.',
  },
  48: {
    name: 'NoLiquidityShares',
    message: 'The pool has no liquidity shares to remove.',
  },
  49: {
    name: 'LiquidityTokenNotSet',
    message: 'The liquidity token is not configured on the treasury.',
  },
  50: {
    name: 'CallRegistryNotSet',
    message: 'The call registry is not configured on the treasury.',
  },
};

/**
 * Looks up a contract error code.
 *
 * An unrecognised code is reported as unknown rather than guessed at — a
 * contract deployed ahead of this backend will emit codes this map has never
 * seen, and inventing a message for them would be worse than admitting it.
 */
export function describeContractError(code: number): ContractErrorInfo {
  return (
    CONTRACT_ERRORS[code] ?? {
      name: `UnknownContractError(${code})`,
      message: `The contract returned error code ${code}, which this service does not recognise.`,
    }
  );
}
