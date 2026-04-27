#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, BytesN, Env, Map,
    Symbol, Vec,
};
use governance::errors::ContractError;

const OWNER: Symbol = symbol_short!("OWNER");
const ORACLES: Symbol = symbol_short!("ORACLES");
const CALLS: Symbol = symbol_short!("CALLS");
const WITHDRAWALS: Symbol = symbol_short!("WITHDRAW");
const CALL_REGISTRY: Symbol = symbol_short!("CALL_REG");
const IS_PAUSED: Symbol = symbol_short!("PAUSED");
const FEE_CONFIG: Symbol = symbol_short!("FEE_CFG");
const ORACLE_BONDS: Symbol = symbol_short!("ORBONDS");
const CALL_ORACLES: Symbol = symbol_short!("CLLORCL");
const ORACLE_BOND_TOKEN: Symbol = symbol_short!("ORBTOKEN");
const SLASHED_CALLS: Symbol = symbol_short!("SLSHCALL");
const QUORUM_NUM: Symbol = symbol_short!("Q_NUM");
const QUORUM_DEN: Symbol = symbol_short!("Q_DEN");
const VOTES: Symbol = symbol_short!("VOTES");
const CROSS_CHAIN_HASHES: Symbol = symbol_short!("CCHASH"); // Issue #234

const BASIS_POINTS_DENOMINATOR: i128 = 10_000;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CallData {
    pub id: u64,
    pub token: Address,
    pub long_tokens: u128,
    pub short_tokens: u128,
    pub end_ts: u64,
    pub settled: bool,
    pub outcome: Option<bool>,
    pub final_price: Option<u128>,
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

/// A single oracle vote for a call outcome.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OracleVote {
    pub oracle: BytesN<32>,
    pub outcome: bool,
    pub final_price: u128,
    pub timestamp: u64,
}

/// Quorum configuration: numerator / denominator (e.g. 2/3).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct QuorumConfig {
    pub numerator: u32,
    pub denominator: u32,
}

/// Cross-chain hash lock reference (Issue #234)
/// Stores a hash posted on another chain (e.g., Base) that can be used
/// to verify the outcome submitted on Soroban.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CrossChainReference {
    /// The keccak256/SHA-256 hash of the outcome data posted on the other chain.
    pub outcome_hash: BytesN<32>,
    /// The chain ID where the hash was posted (e.g., 8453 for Base).
    pub source_chain_id: u64,
    /// The transaction hash on the source chain.
    pub source_tx_hash: BytesN<32>,
    /// Block number on the source chain.
    pub source_block_number: u64,
    /// Timestamp when the reference was created.
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum Event {
    OutcomeSubmitted(u64, bool, u128, BytesN<32>, u32), // Added: total votes count
    OutcomeOverturned(u64, bool, u128, u64),            // Added: call end_ts
    CallSettled(u64, bool, u128, u64),                  // Added: total vote count
    PayoutWithdrawn(u64, Address, u128, bool),          // Added: settlement outcome
    OracleUpdated(BytesN<32>, bool, u32),               // Added: total oracle count
    OracleBondDeposited(BytesN<32>, u128, u128),        // Added: total bond amount
    OracleBondSlashed(u64, BytesN<32>, u128, Address, u128), // Added: remaining bond
    CrossChainHashPosted(u64, BytesN<32>, u64),        // Issue #234: call_id, hash, chain_id
    CrossChainVerified(u64, bool),                     // Issue #234: call_id, verified
}

#[contract]
pub struct OutcomeManagerContract;

#[contractimpl]
impl OutcomeManagerContract {
    fn owner_address(env: &Env) -> Address {
        env.storage().instance().get(&OWNER).unwrap()
    }

    fn require_owner_auth(env: &Env) {
        let owner = Self::owner_address(env);
        owner.require_auth();
    }

    fn is_paused(env: &Env) -> bool {
        env.storage().persistent().get(&IS_PAUSED).unwrap_or(false)
    }

    fn assert_not_paused(env: &Env) {
        if Self::is_paused(env) {
            panic!("{:?}", ContractError::ContractPaused);
        }
    }

    fn get_fee_config(env: &Env) -> FeeConfig {
        env.storage()
            .persistent()
            .get(&FEE_CONFIG)
            .unwrap_or_else(|| panic!("{:?}", ContractError::FeeConfigNotSet))
    }

    fn to_i128(value: u128) -> i128 {
        i128::try_from(value).expect("Value exceeds i128 range")
    }

    fn to_u128(value: i128) -> u128 {
        u128::try_from(value).expect("Value must be non-negative")
    }

    fn get_oracle_bond_token(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get(&ORACLE_BOND_TOKEN)
            .unwrap_or_else(|| panic!("{:?}", ContractError::OracleBondTokenNotSet))
    }

    /// Count the total number of currently authorized oracles.
    fn count_authorized_oracles(env: &Env) -> u32 {
        let oracles: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&ORACLES)
            .unwrap_or_else(|| Map::new(env));
        let mut count = 0u32;
        for (_key, val) in oracles.iter() {
            if val {
                count += 1;
            }
        }
        count
    }

    /// Initialize the contract with owner and call registry address
    pub fn initialize(env: Env, owner: Address, call_registry: Address) {
        let storage = env.storage().instance();

        if storage.has(&OWNER) {
            panic!("{:?}", ContractError::AlreadyInitialized);
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

        // Initialize oracle bond balances
        let oracle_bonds: Map<BytesN<32>, u128> = Map::new(&env);
        storage.set(&ORACLE_BONDS, &oracle_bonds);

        // Track the oracle that settled each call
        let call_oracles: Map<u64, BytesN<32>> = Map::new(&env);
        storage.set(&CALL_ORACLES, &call_oracles);

        // Track whether a call has already been slashed after an overturn
        let slashed_calls: Map<u64, bool> = Map::new(&env);
        storage.set(&SLASHED_CALLS, &slashed_calls);

        // Initialize empty oracle votes
        let votes: Map<u64, Vec<OracleVote>> = Map::new(&env);
        storage.set(&VOTES, &votes);

        // Initialize cross-chain hash references (Issue #234)
        let cross_chain_hashes: Map<u64, CrossChainReference> = Map::new(&env);
        storage.set(&CROSS_CHAIN_HASHES, &cross_chain_hashes);

        // Initialize pause flag in persistent storage
        env.storage().persistent().set(&IS_PAUSED, &false);

        env.storage().persistent().set(
            &FEE_CONFIG,
            &FeeConfig {
                basis_points: 0,
                treasury: owner,
            },
        );

        // Default quorum: 2/3
        env.storage().persistent().set(&QUORUM_NUM, &2u32);
        env.storage().persistent().set(&QUORUM_DEN, &3u32);
    }

    pub fn set_fee_config(env: Env, basis_points: u32, treasury: Address) {
        Self::require_owner_auth(&env);

        if basis_points > 10_000 {
            panic!("{:?}", ContractError::FeeBasisPointsExceeded);
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

    pub fn set_oracle_bond_token(env: Env, token: Address) {
        Self::require_owner_auth(&env);
        env.storage().persistent().set(&ORACLE_BOND_TOKEN, &token);
    }

    pub fn get_oracle_bond_token_view(env: Env) -> Option<Address> {
        env.storage().persistent().get(&ORACLE_BOND_TOKEN)
    }

    /// Set the quorum threshold as a fraction (numerator / denominator).
    /// E.g. set_quorum_threshold(2, 3) means 2/3 of authorized oracles must agree.
    pub fn set_quorum_threshold(env: Env, numerator: u32, denominator: u32) {
        Self::require_owner_auth(&env);
        if denominator == 0 {
            panic!("{:?}", ContractError::ZeroDenominator);
        }
        if numerator == 0 || numerator > denominator {
            panic!("{:?}", ContractError::InvalidQuorumNumerator);
        }
        env.storage().persistent().set(&QUORUM_NUM, &numerator);
        env.storage().persistent().set(&QUORUM_DEN, &denominator);
    }

    /// Get the current quorum threshold.
    pub fn get_quorum_threshold(env: Env) -> QuorumConfig {
        let numerator: u32 = env.storage().persistent().get(&QUORUM_NUM).unwrap_or(2);
        let denominator: u32 = env.storage().persistent().get(&QUORUM_DEN).unwrap_or(3);
        QuorumConfig {
            numerator,
            denominator,
        }
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
            Event::OracleUpdated(
                oracle,
                authorized,
                Self::count_authorized_oracles(&env), // Total oracle count
            ),
        );
    }

    pub fn deposit_oracle_bond(env: Env, oracle: BytesN<32>, amount: u128) {
        Self::assert_not_paused(&env);

        if amount == 0 {
            panic!("{:?}", ContractError::InvalidAmount);
        }

        let storage = env.storage().instance();
        let oracles: Map<BytesN<32>, bool> =
            storage.get(&ORACLES).unwrap_or_else(|| Map::new(&env));
        if !oracles.get(oracle.clone()).unwrap_or(false) {
            panic!("{:?}", ContractError::OracleNotAuthorized);
        }

        let owner = Self::owner_address(&env);
        owner.require_auth();

        let bond_token = Self::get_oracle_bond_token(&env);
        let token_client = token::Client::new(&env, &bond_token);
        token_client.transfer(
            &owner,
            &env.current_contract_address(),
            &Self::to_i128(amount),
        );

        let mut bonds: Map<BytesN<32>, u128> =
            storage.get(&ORACLE_BONDS).unwrap_or_else(|| Map::new(&env));
        let current_bond = bonds.get(oracle.clone()).unwrap_or(0);
        let updated_bond = current_bond
            .checked_add(amount)
            .expect("Bond balance overflow");
        bonds.set(oracle.clone(), updated_bond);
        storage.set(&ORACLE_BONDS, &bonds);

        env.events().publish(
            (Symbol::new(&env, "oracle_bond_deposited"),),
            Event::OracleBondDeposited(
                oracle,
                amount,
                updated_bond, // New total bond amount
            ),
        );
    }

    pub fn get_oracle_bond(env: Env, oracle: BytesN<32>) -> u128 {
        let storage = env.storage().instance();
        let bonds: Map<BytesN<32>, u128> =
            storage.get(&ORACLE_BONDS).unwrap_or_else(|| Map::new(&env));
        bonds.get(oracle).unwrap_or(0)
    }

    /// Check if an oracle is authorized
    pub fn is_authorized_oracle(env: Env, oracle: BytesN<32>) -> bool {
        let storage = env.storage().instance();
        let oracles: Map<BytesN<32>, bool> =
            storage.get(&ORACLES).unwrap_or_else(|| Map::new(&env));
        oracles.get(oracle).unwrap_or(false)
    }

    /// Submit an oracle vote for a call outcome.
    ///
    /// Accumulates unique authorized oracle signatures. Once the quorum
    /// threshold of oracles agree on the same outcome, the call moves to
    /// Settled status. Returns `true` if this submission triggered settlement.
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

        // Verify call exists and hasn't been settled
        let calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));

        if let Some(call_data) = calls.get(call_id) {
            if call_data.settled {
                panic!("{:?}", ContractError::CallSettled);
            }
        } else {
            panic!("{:?}", ContractError::CallNotFound);
        }

        // Construct message for signature verification
        // Format: call_id (8 bytes) + outcome (1 byte) + final_price (16 bytes) + timestamp (8 bytes)
        let mut message = Bytes::new(&env);

        // Add call_id (u64 big-endian)
        message.push_back((call_id >> 56) as u8);
        message.push_back(((call_id >> 48) & 0xFF) as u8);
        message.push_back(((call_id >> 40) & 0xFF) as u8);
        message.push_back(((call_id >> 32) & 0xFF) as u8);
        message.push_back(((call_id >> 24) & 0xFF) as u8);
        message.push_back(((call_id >> 16) & 0xFF) as u8);
        message.push_back(((call_id >> 8) & 0xFF) as u8);
        message.push_back((call_id & 0xFF) as u8);

        // Add outcome (1 byte)
        message.push_back(if outcome { 1u8 } else { 0u8 });

        // Add final_price (u128 big-endian, 16 bytes)
        for i in (0..16).rev() {
            message.push_back(((final_price >> (i * 8)) & 0xFF) as u8);
        }

        // Add timestamp (u64 big-endian)
        message.push_back((timestamp >> 56) as u8);
        message.push_back(((timestamp >> 48) & 0xFF) as u8);
        message.push_back(((timestamp >> 40) & 0xFF) as u8);
        message.push_back(((timestamp >> 32) & 0xFF) as u8);
        message.push_back(((timestamp >> 24) & 0xFF) as u8);
        message.push_back(((timestamp >> 16) & 0xFF) as u8);
        message.push_back(((timestamp >> 8) & 0xFF) as u8);
        message.push_back((timestamp & 0xFF) as u8);

        // Verify ed25519 signature
        env.crypto()
            .ed25519_verify(&oracle_pubkey, &message, &signature);

        // Verify signer is an authorized oracle
        let oracles: Map<BytesN<32>, bool> =
            storage.get(&ORACLES).unwrap_or_else(|| Map::new(&env));
        let is_authorized = oracles.get(oracle_pubkey.clone()).unwrap_or(false);

        if !is_authorized {
            panic!("{:?}", ContractError::OracleNotAuthorized);
        }

        let bonds: Map<BytesN<32>, u128> =
            storage.get(&ORACLE_BONDS).unwrap_or_else(|| Map::new(&env));
        if bonds.get(oracle_pubkey.clone()).unwrap_or(0) == 0 {
            panic!("{:?}", ContractError::OracleBondRequired);
        }

        // Load existing votes for this call
        let mut all_votes: Map<u64, Vec<OracleVote>> =
            storage.get(&VOTES).unwrap_or_else(|| Map::new(&env));
        let mut call_votes: Vec<OracleVote> =
            all_votes.get(call_id).unwrap_or_else(|| Vec::new(&env));

        // Check this oracle hasn't already voted on this call
        for i in 0..call_votes.len() {
            let existing = call_votes.get(i).unwrap();
            if existing.oracle == oracle_pubkey {
                panic!("{:?}", ContractError::OracleAlreadyVoted);
            }
        }

        // Record the vote
        let vote = OracleVote {
            oracle: oracle_pubkey.clone(),
            outcome,
            final_price,
            timestamp,
        };
        call_votes.push_back(vote);
        all_votes.set(call_id, call_votes.clone());
        storage.set(&VOTES, &all_votes);

        // Emit per-oracle vote event
        env.events().publish(
            (Symbol::new(&env, "outcome_submitted"),),
            Event::OutcomeSubmitted(
                call_id,
                outcome,
                final_price,
                oracle_pubkey.clone(),
                call_votes.len(), // Total votes for this call
            ),
        );

        // Check if quorum is met for this outcome
        let quorum_num: u32 = env.storage().persistent().get(&QUORUM_NUM).unwrap_or(2);
        let quorum_den: u32 = env.storage().persistent().get(&QUORUM_DEN).unwrap_or(3);
        let total_oracles = Self::count_authorized_oracles(&env);

        // Required votes = ceil(total_oracles * numerator / denominator)
        let required = (total_oracles * quorum_num).div_ceil(quorum_den);

        // Count votes agreeing on this specific outcome
        let mut agreeing: u32 = 0;
        let mut price_sum: u128 = 0;
        for i in 0..call_votes.len() {
            let v = call_votes.get(i).unwrap();
            if v.outcome == outcome {
                agreeing += 1;
                price_sum += v.final_price;
            }
        }

        if agreeing >= required && required > 0 {
            // Quorum reached — settle the call with average price from agreeing oracles
            let avg_price = price_sum / (agreeing as u128);

            let mut calls_mut: Map<u64, CallData> =
                storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));
            let mut call_data = calls_mut.get(call_id).unwrap();
            call_data.settled = true;
            call_data.outcome = Some(outcome);
            call_data.final_price = Some(avg_price);
            calls_mut.set(call_id, call_data);
            storage.set(&CALLS, &calls_mut);

            let mut call_oracles: Map<u64, BytesN<32>> =
                storage.get(&CALL_ORACLES).unwrap_or_else(|| Map::new(&env));
            call_oracles.set(call_id, oracle_pubkey.clone());
            storage.set(&CALL_ORACLES, &call_oracles);

            env.events().publish(
                (Symbol::new(&env, "call_settled"),),
                Event::CallSettled(
                    call_id,
                    outcome,
                    avg_price,
                    call_votes.len() as u64, // Total vote count
                ),
            );

            return true;
        }

        false
    }

    /// Get all oracle votes for a call.
    pub fn get_oracle_votes(env: Env, call_id: u64) -> Vec<OracleVote> {
        let storage = env.storage().instance();
        let all_votes: Map<u64, Vec<OracleVote>> =
            storage.get(&VOTES).unwrap_or_else(|| Map::new(&env));
        all_votes.get(call_id).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn overturn_outcome_by_majority(
        env: Env,
        call_id: u64,
        majority_outcome: bool,
        majority_final_price: u128,
    ) -> bool {
        Self::require_owner_auth(&env);

        let storage = env.storage().instance();
        let mut calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));
        let mut call_data = calls
            .get(call_id)
            .unwrap_or_else(|| panic!("{:?}", ContractError::CallNotFound));

        if !call_data.settled {
            panic!("{:?}", ContractError::CallNotSettled);
        }

        let mut was_overturned = false;
        let existing_outcome = call_data
            .outcome
            .unwrap_or_else(|| panic!("{:?}", ContractError::CallOutcomeMissing));

        if existing_outcome != majority_outcome {
            let mut slashed_calls: Map<u64, bool> = storage
                .get(&SLASHED_CALLS)
                .unwrap_or_else(|| Map::new(&env));

            if slashed_calls.get(call_id).unwrap_or(false) {
                panic!("{:?}", ContractError::CallAlreadySlashed);
            }

            let call_oracles: Map<u64, BytesN<32>> =
                storage.get(&CALL_ORACLES).unwrap_or_else(|| Map::new(&env));
            let settling_oracle = call_oracles
                .get(call_id)
                .unwrap_or_else(|| panic!("{:?}", ContractError::CallNotFound));

            let mut bonds: Map<BytesN<32>, u128> =
                storage.get(&ORACLE_BONDS).unwrap_or_else(|| Map::new(&env));
            let slash_amount = bonds.get(settling_oracle.clone()).unwrap_or(0);

            if slash_amount > 0 {
                bonds.set(settling_oracle.clone(), 0);
                storage.set(&ORACLE_BONDS, &bonds);

                let fee_config = Self::get_fee_config(&env);
                let bond_token = Self::get_oracle_bond_token(&env);
                let token_client = token::Client::new(&env, &bond_token);
                token_client.transfer(
                    &env.current_contract_address(),
                    &fee_config.treasury,
                    &Self::to_i128(slash_amount),
                );

                env.events().publish(
                    (Symbol::new(&env, "oracle_bond_slashed"),),
                    Event::OracleBondSlashed(
                        call_id,
                        settling_oracle,
                        slash_amount,
                        fee_config.treasury,
                        0u128, // Remaining bond (now 0 after slash)
                    ),
                );
            }

            slashed_calls.set(call_id, true);
            storage.set(&SLASHED_CALLS, &slashed_calls);
            was_overturned = true;
        }

        call_data.outcome = Some(majority_outcome);
        call_data.final_price = Some(majority_final_price);
        let end_ts = call_data.end_ts; // Clone before move
        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);

        if was_overturned {
            env.events().publish(
                (Symbol::new(&env, "outcome_overturned"),),
                Event::OutcomeOverturned(
                    call_id,
                    majority_outcome,
                    majority_final_price,
                    end_ts, // Call end timestamp
                ),
            );
        }

        was_overturned
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
            settled: false,
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

        // Check if user already withdrew
        let withdrawals: Map<(u64, Address), bool> =
            storage.get(&WITHDRAWALS).unwrap_or_else(|| Map::new(&env));

        if let Some(withdrawn) = withdrawals.get((call_id, user.clone())) {
            if withdrawn {
                panic!("{:?}", ContractError::AlreadyWithdrawn);
            }
        }

        // Get call data
        let calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));
        let call_data = calls
            .get(call_id)
            .unwrap_or_else(|| panic!("{:?}", ContractError::CallNotFound));

        // Verify call is settled
        if !call_data.settled {
            panic!("{:?}", ContractError::CallNotSettled);
        }

        let outcome = call_data.outcome.unwrap();
        let gross_payout: i128 = if user_side == outcome {
            // User won - calculate their share
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

            // User gets their stake back + their share of losing side
            user_stake_i128 + ((user_stake_i128 * losing_tokens) / winning_tokens)
        } else {
            // User lost - no payout (their stake is already gone)
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

        // Mark withdrawal as done
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

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "payout_withdrawn"),),
            Event::PayoutWithdrawn(
                call_id,
                user,
                payout,
                outcome, // Settlement outcome for reference
            ),
        );

        payout
    }

    /// Get call data (view function)
    pub fn get_call(env: Env, call_id: u64) -> Option<CallData> {
        let storage = env.storage().instance();
        let calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));
        calls.get(call_id)
    }

    /// Check if user already withdrew from a call
    pub fn has_withdrawn(env: Env, call_id: u64, user: Address) -> bool {
        let storage = env.storage().instance();
        let withdrawals: Map<(u64, Address), bool> =
            storage.get(&WITHDRAWALS).unwrap_or_else(|| Map::new(&env));

        withdrawals.get((call_id, user)).unwrap_or(false)
    }

    // ── Cross-Chain Oracle Reference (Issue #234) ─────────────────────────────

    /// Post a cross-chain hash reference for a call outcome.
    ///
    /// This allows an outcome submitted on Soroban to be verified against
    /// a hash posted on another chain (e.g., Base). The hash should be
    /// computed as: keccak256(call_id || outcome || final_price || timestamp)
    ///
    /// # Arguments
    /// * `call_id` - The ID of the call
    /// * `outcome_hash` - The hash posted on the source chain
    /// * `source_chain_id` - Chain ID where hash was posted (e.g., 8453 for Base)
    /// * `source_tx_hash` - Transaction hash on the source chain
    /// * `source_block_number` - Block number on the source chain
    pub fn post_cross_chain_hash(
        env: Env,
        call_id: u64,
        outcome_hash: BytesN<32>,
        source_chain_id: u64,
        source_tx_hash: BytesN<32>,
        source_block_number: u64,
    ) {
        Self::require_owner_auth(&env);

        let storage = env.storage().instance();
        let mut hashes: Map<u64, CrossChainReference> =
            storage.get(&CROSS_CHAIN_HASHES).unwrap_or_else(|| Map::new(&env));

        let cross_chain_ref = CrossChainReference {
            outcome_hash: outcome_hash.clone(),
            source_chain_id,
            source_tx_hash,
            source_block_number,
            timestamp: env.ledger().timestamp(),
        };

        hashes.set(call_id, cross_chain_ref);
        storage.set(&CROSS_CHAIN_HASHES, &hashes);

        env.events().publish(
            (Symbol::new(&env, "cross_chain_hash_posted"),),
            Event::CrossChainHashPosted(call_id, outcome_hash, source_chain_id),
        );
    }

    /// Verify an outcome against a cross-chain hash reference.
    ///
    /// This function checks if the provided outcome data matches the
    /// hash that was previously posted from another chain.
    ///
    /// # Arguments
    /// * `call_id` - The ID of the call
    /// * `outcome` - The outcome to verify
    /// * `final_price` - The final price to verify
    /// * `timestamp` - The timestamp to verify
    ///
    /// # Returns
    /// `true` if the outcome matches the cross-chain hash, `false` otherwise
    pub fn verify_cross_chain_outcome(
        env: Env,
        call_id: u64,
        outcome: bool,
        final_price: u128,
        timestamp: u64,
    ) -> bool {
        let storage = env.storage().instance();
        let hashes: Map<u64, CrossChainReference> =
            storage.get(&CROSS_CHAIN_HASHES).unwrap_or_else(|| Map::new(&env));

        let cross_chain_ref = match hashes.get(call_id) {
            Some(ref_hash) => ref_hash,
            None => panic!("{:?}", ContractError::NoCrossChainReference),
        };

        // Recompute the hash from the provided outcome data
        // Format: call_id (8 bytes) + outcome (1 byte) + final_price (16 bytes) + timestamp (8 bytes)
        let mut message = Bytes::new(&env);

        // Add call_id (u64 big-endian)
        message.push_back((call_id >> 56) as u8);
        message.push_back(((call_id >> 48) & 0xFF) as u8);
        message.push_back(((call_id >> 40) & 0xFF) as u8);
        message.push_back(((call_id >> 32) & 0xFF) as u8);
        message.push_back(((call_id >> 24) & 0xFF) as u8);
        message.push_back(((call_id >> 16) & 0xFF) as u8);
        message.push_back(((call_id >> 8) & 0xFF) as u8);
        message.push_back((call_id & 0xFF) as u8);

        // Add outcome (1 byte)
        message.push_back(if outcome { 1u8 } else { 0u8 });

        // Add final_price (u128 big-endian, 16 bytes)
        for i in (0..16).rev() {
            message.push_back(((final_price >> (i * 8)) & 0xFF) as u8);
        }

        // Add timestamp (u64 big-endian)
        message.push_back((timestamp >> 56) as u8);
        message.push_back(((timestamp >> 48) & 0xFF) as u8);
        message.push_back(((timestamp >> 40) & 0xFF) as u8);
        message.push_back(((timestamp >> 32) & 0xFF) as u8);
        message.push_back(((timestamp >> 24) & 0xFF) as u8);
        message.push_back(((timestamp >> 16) & 0xFF) as u8);
        message.push_back(((timestamp >> 8) & 0xFF) as u8);
        message.push_back((timestamp & 0xFF) as u8);

        // Compute SHA-256 hash of the message
        let computed_hash = env.crypto().sha256(&message);

        // Compare with the stored cross-chain hash
        let verified = computed_hash.to_bytes() == cross_chain_ref.outcome_hash;

        env.events().publish(
            (Symbol::new(&env, "cross_chain_verified"),),
            Event::CrossChainVerified(call_id, verified),
        );

        verified
    }

    /// Get the cross-chain reference for a call.
    pub fn get_cross_chain_reference(env: Env, call_id: u64) -> Option<CrossChainReference> {
        let storage = env.storage().instance();
        let hashes: Map<u64, CrossChainReference> =
            storage.get(&CROSS_CHAIN_HASHES).unwrap_or_else(|| Map::new(&env));
        hashes.get(call_id)
    }
}

mod test;
