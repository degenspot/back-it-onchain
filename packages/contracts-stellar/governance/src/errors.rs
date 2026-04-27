use soroban_sdk::contracterror;

/// Domain-specific error codes for the BackItOnchain contracts.
/// These replace generic `panic!` calls to provide better integration
/// with frontend SDKs and error handling.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ContractError {
    // ── Authorization & Access Control ─────────────────────────────────────
    /// Caller is not authorized to perform this action.
    Unauthorized = 1,
    /// Contract is paused and write operations are disabled.
    ContractPaused = 2,
    /// Admin has not been set or cannot be found.
    AdminNotSet = 3,

    // ── Call Lifecycle Errors ─────────────────────────────────────────────
    /// The call has already ended (past end timestamp).
    CallEnded = 4,
    /// The call has already been settled.
    CallSettled = 5,
    /// The call has not ended yet (cannot finalize before end_ts).
    CallNotEnded = 6,
    /// The call has not been settled yet.
    CallNotSettled = 7,
    /// Attempted to initialize an already-initialized contract.
    AlreadyInitialized = 8,
    /// Call does not exist in storage.
    CallNotFound = 9,

    // ── Validation Errors ─────────────────────────────────────────────────
    /// Stake or transfer amount must be greater than zero.
    InvalidAmount = 10,
    /// End timestamp must be in the future.
    InvalidEndTime = 11,
    /// Outcome index is out of bounds for this call.
    InvalidOutcomeIndex = 12,
    /// Invalid winning outcome index.
    InvalidWinningOutcome = 13,
    /// Number of outcomes must be at least 2.
    TooFewOutcomes = 14,
    /// Number of outcomes exceeds maximum (32).
    TooManyOutcomes = 15,
    /// No fees available for dividend distribution.
    NoFeesToDistribute = 16,
    /// Total governance weight is zero.
    ZeroWeight = 17,
    /// Call is not yet settled (cannot archive).
    CallNotSettledForArchive = 18,

    // ── User Stake & Withdrawal Errors ────────────────────────────────────
    /// User has no stake on the specified outcome.
    NoStakeFound = 19,
    /// User did not stake on the winning outcome.
    NotOnWinningSide = 20,
    /// Nothing to withdraw (stake is zero).
    NothingToWithdraw = 21,

    // ── Token Whitelist Errors ────────────────────────────────────────────
    /// Token is not whitelisted for use as stake_token.
    TokenNotWhitelisted = 22,
    /// Caller is not an authorized staker.
    NotAuthorizedStaker = 23,
    /// No token proposal exists for the given token.
    NoTokenProposal = 24,

    // ── Oracle & Outcome Manager Errors ───────────────────────────────────
    /// Oracle is not authorized to submit outcomes.
    OracleNotAuthorized = 25,
    /// Oracle has not deposited the required bond.
    OracleBondRequired = 26,
    /// Oracle has already voted on this call.
    OracleAlreadyVoted = 27,
    /// Call outcome is missing or not set.
    CallOutcomeMissing = 28,
    /// Call has already been slashed after an overturn.
    CallAlreadySlashed = 29,
    /// Fee configuration has not been set.
    FeeConfigNotSet = 30,
    /// Oracle bond token has not been configured.
    OracleBondTokenNotSet = 31,
    /// Quorum denominator cannot be zero.
    ZeroDenominator = 32,
    /// Quorum numerator is invalid.
    InvalidQuorumNumerator = 33,
    /// Fee basis points exceed maximum (10000).
    FeeBasisPointsExceeded = 34,

    // ── Withdrawal & Payout Errors ────────────────────────────────────────
    /// User has already withdrawn their payout.
    AlreadyWithdrawn = 35,

    // ── Cross-Chain Oracle Errors (Issue #234) ────────────────────────────
    /// Cross-chain hash lock verification failed.
    HashLockVerificationFailed = 36,
    /// No cross-chain reference found for this call.
    NoCrossChainReference = 37,

    // ── Arithmetic Errors ─────────────────────────────────────────────────
    /// Arithmetic overflow detected.
    ArithmeticOverflow = 38,
}
