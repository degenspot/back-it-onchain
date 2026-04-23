use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// Contract has already been initialised.
    AlreadyInitialized = 1,
    /// The call_id does not exist.
    CallNotFound = 2,
    /// A call with this call_id already exists.
    CallAlreadyExists = 3,
    /// The proposal window for this call has already closed.
    ProposalWindowExpired = 4,
    /// The proposal window is still open; cannot finalise yet.
    ProposalWindowStillOpen = 5,
    /// Bond amount is below the minimum required.
    BondTooLow = 6,
    /// The call is not in a Disputed state.
    NotDisputed = 7,
    /// Internal: dispute record missing despite Disputed state.
    NoDisputeRecord = 8,
    /// The requested state transition is not allowed.
    InvalidStateTransition = 9,
    /// The bond token address has not been configured.
    TokenNotSet = 10,
    /// Arithmetic overflow.
    Overflow = 11,
}
