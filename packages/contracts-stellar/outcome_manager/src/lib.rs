#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, BytesN, Env, Map,
    Symbol,
};

const OWNER: Symbol = symbol_short!("OWNER");
const ORACLES: Symbol = symbol_short!("ORACLES");
const CALLS: Symbol = symbol_short!("CALLS");
const WITHDRAWALS: Symbol = symbol_short!("WITHDRAW");
const CALL_REGISTRY: Symbol = symbol_short!("CALL_REG");
const IS_PAUSED: Symbol = symbol_short!("PAUSED");
const FEE_CONFIG: Symbol = symbol_short!("FEE_CFG");
const PROPOSAL_WINDOW_SECS: Symbol = symbol_short!("PROPWIN");

const BASIS_POINTS_DENOMINATOR: i128 = 10_000;

/// Default challenge window after the first oracle outcome is recorded (24 hours).
const DEFAULT_PROPOSAL_WINDOW_SECS: u64 = 86_400;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CallData {
    pub id: u64,
    pub token: Address,
    pub long_tokens: u128,
    pub short_tokens: u128,
    pub end_ts: u64,
    pub lifecycle: CallLifecycle,
    pub outcome: Option<bool>,
    pub final_price: Option<u128>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum CallLifecycle {
    /// No oracle proposal yet.
    Open,
    /// Oracle signed outcome is on record; challengers may `dispute_outcome` until `window_end_ts`.
    Proposed {
        outcome: bool,
        final_price: u128,
        window_end_ts: u64,
    },
    /// A bond is locked; owner (admin/DAO) must call a resolve function.
    Disputed {
        proposed_outcome: bool,
        proposed_final_price: u128,
        disputer: Address,
        bond: i128,
    },
    /// Final; payouts allowed.
    Settled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StakeData {
    pub user: Address,
    pub amount: u128,
    pub side: bool, // true = long, false = short
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FeeConfig {
    pub basis_points: u32,
    pub treasury: Address,
}

#[contracttype]
#[derive(Clone)]
pub enum Event {
    OutcomeSubmitted(u64, bool, u128, BytesN<32>),
    PayoutWithdrawn(u64, Address, u128),
    OracleUpdated(BytesN<32>, bool),
    OutcomeDisputed(u64, Address, i128),
    ProposalWindowFinalized(u64, bool, u128),
    DisputeResolvedUphold(u64),
    DisputeResolvedOverride(u64, bool, u128),
}

#[contract]
pub struct OutcomeManagerContract;

#[contractimpl]
impl OutcomeManagerContract {
    fn require_owner_auth(env: &Env) {
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        owner.require_auth();
    }

    fn is_paused(env: &Env) -> bool {
        env.storage().persistent().get(&IS_PAUSED).unwrap_or(false)
    }

    fn assert_not_paused(env: &Env) {
        if Self::is_paused(env) {
            panic!("Contract is paused");
        }
    }

    fn get_fee_config(env: &Env) -> FeeConfig {
        env.storage()
            .persistent()
            .get(&FEE_CONFIG)
            .expect("Fee config not set")
    }

    fn proposal_window_secs(env: &Env) -> u64 {
        env.storage()
            .persistent()
            .get(&PROPOSAL_WINDOW_SECS)
            .unwrap_or(DEFAULT_PROPOSAL_WINDOW_SECS)
    }

    fn to_i128(value: u128) -> i128 {
        i128::try_from(value).expect("Value exceeds i128 range")
    }

    fn to_u128(value: i128) -> u128 {
        u128::try_from(value).expect("Value must be non-negative")
    }

    fn call_settled(call: &CallData) -> bool {
        matches!(call.lifecycle, CallLifecycle::Settled)
    }

    /// Initialize the contract with owner and call registry address
    pub fn initialize(env: Env, owner: Address, call_registry: Address) {
        let storage = env.storage().instance();

        if storage.has(&OWNER) {
            panic!("Contract already initialized");
        }

        storage.set(&OWNER, &owner);
        storage.set(&CALL_REGISTRY, &call_registry);

        // Initialize empty oracles map
        let oracles: Map<BytesN<32>, bool> = Map::new(&env);
        storage.set(&ORACLES, &oracles);

        // Initialize empty calls map
        let calls: Map<u64, CallData> = Map::new(&env);
        storage.set(&CALLS, &calls);

        // Initialize empty withdrawals tracking
        let withdrawals: Map<(u64, Address), bool> = Map::new(&env);
        storage.set(&WITHDRAWALS, &withdrawals);

        // Initialize pause flag in persistent storage
        env.storage().persistent().set(&IS_PAUSED, &false);

        env.storage().persistent().set(
            &FEE_CONFIG,
            &FeeConfig {
                basis_points: 0,
                treasury: owner,
            },
        );

        env.storage()
            .persistent()
            .set(&PROPOSAL_WINDOW_SECS, &DEFAULT_PROPOSAL_WINDOW_SECS);
    }

    /// Owner: duration in seconds for the dispute bond window after the first oracle proposal.
    pub fn set_proposal_window(env: Env, secs: u64) {
        Self::require_owner_auth(&env);
        if secs == 0 {
            panic!("Proposal window must be > 0");
        }
        env.storage().persistent().set(&PROPOSAL_WINDOW_SECS, &secs);
    }

    pub fn get_proposal_window(env: Env) -> u64 {
        Self::proposal_window_secs(&env)
    }

    pub fn set_fee_config(env: Env, basis_points: u32, treasury: Address) {
        Self::require_owner_auth(&env);

        if basis_points > 10_000 {
            panic!("Fee basis points cannot exceed 10000");
        }

        env.storage().persistent().set(
            &FEE_CONFIG,
            &FeeConfig {
                basis_points,
                treasury,
            },
        );
    }

    pub fn get_fee_config_view(env: Env) -> FeeConfig {
        Self::get_fee_config(&env)
    }

    /// Pause write operations (owner only)
    pub fn pause(env: Env) {
        Self::require_owner_auth(&env);
        env.storage().persistent().set(&IS_PAUSED, &true);
    }

    /// Resume write operations (owner only)
    pub fn unpause(env: Env) {
        Self::require_owner_auth(&env);
        env.storage().persistent().set(&IS_PAUSED, &false);
    }

    pub fn get_is_paused(env: Env) -> bool {
        Self::is_paused(&env)
    }

    /// Set oracle authorization status (owner only)
    pub fn set_oracle(env: Env, oracle: BytesN<32>, authorized: bool) {
        let storage = env.storage().instance();
        Self::require_owner_auth(&env);

        let mut oracles: Map<BytesN<32>, bool> = storage.get(&ORACLES).unwrap();
        oracles.set(oracle.clone(), authorized);
        storage.set(&ORACLES, &oracles);

        env.events().publish(
            (Symbol::new(&env, "oracle_updated"),),
            Event::OracleUpdated(oracle, authorized),
        );
    }

    /// Check if an oracle is authorized
    pub fn is_authorized_oracle(env: Env, oracle: BytesN<32>) -> bool {
        let storage = env.storage().instance();
        let oracles: Map<BytesN<32>, bool> =
            storage.get(&ORACLES).unwrap_or_else(|| Map::new(&env));
        oracles.get(oracle).unwrap_or(false)
    }

    /// Submit outcome with ed25519 signature verification.
    /// Starts the proposal window; call is not final until the window passes without dispute or admin resolves.
    pub fn submit_outcome(
        env: Env,
        call_id: u64,
        outcome: bool,
        final_price: u128,
        timestamp: u64,
        oracle_pubkey: BytesN<32>,
        signature: BytesN<64>,
    ) -> bool {
        Self::assert_not_paused(&env);
        let storage = env.storage().instance();

        let mut calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));

        let mut call_data = match calls.get(call_id) {
            Some(c) => c,
            None => panic!("Call not found"),
        };

        if !matches!(call_data.lifecycle, CallLifecycle::Open) {
            panic!("Outcome already proposed or call not open");
        }

        // Construct message for signature verification
        let mut message = Bytes::new(&env);

        message.push_back((call_id >> 56) as u8);
        message.push_back(((call_id >> 48) & 0xFF) as u8);
        message.push_back(((call_id >> 40) & 0xFF) as u8);
        message.push_back(((call_id >> 32) & 0xFF) as u8);
        message.push_back(((call_id >> 24) & 0xFF) as u8);
        message.push_back(((call_id >> 16) & 0xFF) as u8);
        message.push_back(((call_id >> 8) & 0xFF) as u8);
        message.push_back((call_id & 0xFF) as u8);

        message.push_back(if outcome { 1u8 } else { 0u8 });

        for i in (0..16).rev() {
            message.push_back(((final_price >> (i * 8)) & 0xFF) as u8);
        }

        message.push_back((timestamp >> 56) as u8);
        message.push_back(((timestamp >> 48) & 0xFF) as u8);
        message.push_back(((timestamp >> 40) & 0xFF) as u8);
        message.push_back(((timestamp >> 32) & 0xFF) as u8);
        message.push_back(((timestamp >> 24) & 0xFF) as u8);
        message.push_back(((timestamp >> 16) & 0xFF) as u8);
        message.push_back(((timestamp >> 8) & 0xFF) as u8);
        message.push_back((timestamp & 0xFF) as u8);

        env.crypto()
            .ed25519_verify(&oracle_pubkey, &message, &signature);

        let oracles: Map<BytesN<32>, bool> =
            storage.get(&ORACLES).unwrap_or_else(|| Map::new(&env));
        if !oracles.get(oracle_pubkey.clone()).unwrap_or(false) {
            panic!("Oracle not authorized");
        }

        let now = env.ledger().timestamp();
        let window = Self::proposal_window_secs(&env);
        let window_end_ts = now.checked_add(window).expect("Window end overflow");

        call_data.lifecycle = CallLifecycle::Proposed {
            outcome,
            final_price,
            window_end_ts,
        };
        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);

        env.events().publish(
            (Symbol::new(&env, "outcome_submitted"),),
            Event::OutcomeSubmitted(call_id, outcome, final_price, oracle_pubkey),
        );

        true
    }

    /// Anyone may finalize after the proposal window if no dispute was raised.
    pub fn finalize_proposed_outcome(env: Env, call_id: u64) {
        Self::assert_not_paused(&env);
        let storage = env.storage().instance();
        let mut calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));

        let mut call_data = calls.get(call_id).expect("Call not found");

        let (outcome, price, window_end_ts) = match &call_data.lifecycle {
            CallLifecycle::Proposed {
                outcome,
                final_price,
                window_end_ts,
            } => (*outcome, *final_price, *window_end_ts),
            _ => panic!("Call not in proposed state"),
        };

        if env.ledger().timestamp() < window_end_ts {
            panic!("Proposal window still active");
        }

        call_data.lifecycle = CallLifecycle::Settled;
        call_data.outcome = Some(outcome);
        call_data.final_price = Some(price);
        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);

        env.events().publish(
            (Symbol::new(&env, "proposal_finalized"),),
            Event::ProposalWindowFinalized(call_id, outcome, price),
        );
    }

    /// Lock a bond and move the call to `Disputed` during the proposal window.
    pub fn dispute_outcome(env: Env, call_id: u64, staker: Address, bond_amount: i128) {
        Self::assert_not_paused(&env);
        staker.require_auth();

        if bond_amount <= 0 {
            panic!("Bond amount must be > 0");
        }

        let storage = env.storage().instance();
        let mut calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));

        let mut call_data = calls.get(call_id).expect("Call not found");

        let (proposed_outcome, proposed_final_price, window_end_ts) = match &call_data.lifecycle {
            CallLifecycle::Proposed {
                outcome,
                final_price,
                window_end_ts,
            } => (*outcome, *final_price, *window_end_ts),
            _ => panic!("Call not disputable"),
        };

        if env.ledger().timestamp() >= window_end_ts {
            panic!("Proposal window ended");
        }

        let token_client = token::Client::new(&env, &call_data.token);
        token_client.transfer(&staker, &env.current_contract_address(), &bond_amount);

        call_data.lifecycle = CallLifecycle::Disputed {
            proposed_outcome,
            proposed_final_price,
            disputer: staker.clone(),
            bond: bond_amount,
        };
        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);

        env.events().publish(
            (Symbol::new(&env, "outcome_disputed"),),
            Event::OutcomeDisputed(call_id, staker, bond_amount),
        );
    }

    /// Owner: oracle proposal stands; disputer bond is slashed to treasury (frivolous dispute).
    pub fn resolve_dispute_uphold_proposal(env: Env, call_id: u64) {
        Self::require_owner_auth(&env);
        Self::assert_not_paused(&env);

        let storage = env.storage().instance();
        let mut calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));

        let mut call_data = calls.get(call_id).expect("Call not found");

        let (proposed_outcome, proposed_final_price, bond) = match &call_data.lifecycle {
            CallLifecycle::Disputed {
                proposed_outcome,
                proposed_final_price,
                bond,
                ..
            } => (*proposed_outcome, *proposed_final_price, *bond),
            _ => panic!("Call not disputed"),
        };

        let fee_config = Self::get_fee_config(&env);
        let token_client = token::Client::new(&env, &call_data.token);

        if bond > 0 {
            token_client.transfer(&env.current_contract_address(), &fee_config.treasury, &bond);
        }

        call_data.lifecycle = CallLifecycle::Settled;
        call_data.outcome = Some(proposed_outcome);
        call_data.final_price = Some(proposed_final_price);
        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);

        env.events().publish(
            (Symbol::new(&env, "dispute_resolved_uphold"),),
            Event::DisputeResolvedUphold(call_id),
        );
    }

    /// Owner: override the proposed outcome (DAO/admin resolution); return the bond to the disputer.
    pub fn resolve_dispute_override(
        env: Env,
        call_id: u64,
        final_outcome: bool,
        final_price: u128,
    ) {
        Self::require_owner_auth(&env);
        Self::assert_not_paused(&env);

        let storage = env.storage().instance();
        let mut calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));

        let mut call_data = calls.get(call_id).expect("Call not found");

        let (disputer, bond) = match &call_data.lifecycle {
            CallLifecycle::Disputed { disputer, bond, .. } => (disputer.clone(), *bond),
            _ => panic!("Call not disputed"),
        };

        let token_client = token::Client::new(&env, &call_data.token);

        if bond > 0 {
            token_client.transfer(&env.current_contract_address(), &disputer, &bond);
        }

        call_data.lifecycle = CallLifecycle::Settled;
        call_data.outcome = Some(final_outcome);
        call_data.final_price = Some(final_price);
        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);

        env.events().publish(
            (Symbol::new(&env, "dispute_resolved_override"),),
            Event::DisputeResolvedOverride(call_id, final_outcome, final_price),
        );
    }

    /// Register a call (called by CallRegistry or stake contract)
    pub fn register_call(
        env: Env,
        call_id: u64,
        token: Address,
        long_tokens: u128,
        short_tokens: u128,
        end_ts: u64,
    ) {
        let storage = env.storage().instance();
        let mut calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));

        let call_data = CallData {
            id: call_id,
            token,
            long_tokens,
            short_tokens,
            end_ts,
            lifecycle: CallLifecycle::Open,
            outcome: None,
            final_price: None,
        };

        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);
    }

    /// Withdraw payout for a settled call
    pub fn withdraw_payout(
        env: Env,
        call_id: u64,
        user: Address,
        user_stake: u128,
        user_side: bool,
    ) -> u128 {
        let storage = env.storage().instance();
        user.require_auth();

        let withdrawals: Map<(u64, Address), bool> =
            storage.get(&WITHDRAWALS).unwrap_or_else(|| Map::new(&env));

        if let Some(withdrawn) = withdrawals.get((call_id, user.clone())) {
            if withdrawn {
                panic!("Already withdrawn");
            }
        }

        let calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));
        let call_data = calls
            .get(call_id)
            .unwrap_or_else(|| panic!("Call not found"));

        if !Self::call_settled(&call_data) {
            panic!("Call not settled");
        }

        let outcome = call_data.outcome.unwrap();
        let gross_payout: i128 = if user_side == outcome {
            let winning_tokens = if outcome {
                Self::to_i128(call_data.long_tokens)
            } else {
                Self::to_i128(call_data.short_tokens)
            };

            let losing_tokens = if outcome {
                Self::to_i128(call_data.short_tokens)
            } else {
                Self::to_i128(call_data.long_tokens)
            };

            let user_stake_i128 = Self::to_i128(user_stake);

            user_stake_i128 + ((user_stake_i128 * losing_tokens) / winning_tokens)
        } else {
            0
        };

        let fee_config = Self::get_fee_config(&env);
        let fee_amount = if gross_payout > 0 {
            gross_payout
                .checked_mul(i128::from(fee_config.basis_points))
                .expect("Fee multiplication overflow")
                / BASIS_POINTS_DENOMINATOR
        } else {
            0
        };
        let net_payout = gross_payout - fee_amount;

        let mut new_withdrawals = withdrawals.clone();
        new_withdrawals.set((call_id, user.clone()), true);
        storage.set(&WITHDRAWALS, &new_withdrawals);

        if net_payout > 0 {
            let token_client = token::Client::new(&env, &call_data.token);
            token_client.transfer(&env.current_contract_address(), &user, &net_payout);

            if fee_amount > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &fee_config.treasury,
                    &fee_amount,
                );
            }
        }

        let payout = Self::to_u128(net_payout);

        env.events().publish(
            (Symbol::new(&env, "payout_withdrawn"),),
            Event::PayoutWithdrawn(call_id, user, payout),
        );

        payout
    }

    /// Get call data (view function)
    pub fn get_call(env: Env, call_id: u64) -> Option<CallData> {
        let storage = env.storage().instance();
        let calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));
        calls.get(call_id)
    }

    /// True when the call is in `Settled` lifecycle (payouts allowed).
    pub fn is_call_settled(env: Env, call_id: u64) -> bool {
        let storage = env.storage().instance();
        let calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));
        calls
            .get(call_id)
            .map(|c| Self::call_settled(&c))
            .unwrap_or(false)
    }

    /// Check if user already withdrew from a call
    pub fn has_withdrawn(env: Env, call_id: u64, user: Address) -> bool {
        let storage = env.storage().instance();
        let withdrawals: Map<(u64, Address), bool> =
            storage.get(&WITHDRAWALS).unwrap_or_else(|| Map::new(&env));

        withdrawals.get((call_id, user)).unwrap_or(false)
    }
}

mod test;
