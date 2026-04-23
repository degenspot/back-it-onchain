use soroban_sdk::{contracttype, Address};

/// All possible states a call can be in.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum CallState {
    /// Outcome submitted; proposal window is still open.
    Proposed,
    /// A staker has locked a bond and challenged the outcome.
    Disputed,
    /// Admin/DAO has settled the dispute.
    Resolved,
    /// Proposal window closed with no challenge; outcome is canonical.
    Finalized,
}

/// The outcome payload — extend with richer fields as needed.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CallOutcome {
    /// Arbitrary outcome identifier (e.g., option index, IPFS CID hash, etc.)
    pub result_code: u32,
    /// Optional human-readable summary stored on-chain for auditability.
    pub memo: soroban_sdk::Bytes,
}

/// How the admin/DAO resolves a dispute.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DisputeResolution {
    /// The dispute was valid — overrule the original outcome, return the bond.
    UpholdDispute,
    /// The dispute was frivolous — keep the original outcome, slash the bond.
    RejectDispute,
}

/// Record of a single dispute raised against a call.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeRecord {
    /// Address that posted the challenge bond.
    pub staker: Address,
    /// Amount of tokens locked as bond.
    pub bond_amount: i128,
    /// Ledger timestamp when the dispute was raised.
    pub disputed_at: u64,
    /// Resolution set by admin/DAO; None while pending.
    pub resolution: Option<DisputeResolution>,
}

/// Full on-chain record for a single call.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CallRecord {
    pub call_id: u64,
    pub submitter: Address,
    pub outcome: CallOutcome,
    /// Ledger timestamp when the outcome was first submitted.
    pub submitted_at: u64,
    /// Timestamp after which no new disputes are accepted.
    pub window_expires_at: u64,
    pub state: CallState,
    /// Populated when state == Disputed or Resolved.
    pub dispute: Option<DisputeRecord>,
}
