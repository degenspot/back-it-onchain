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
const ORACLE_BONDS: Symbol = symbol_short!("ORBONDS");
const CALL_ORACLES: Symbol = symbol_short!("CLLORCL");
const ORACLE_BOND_TOKEN: Symbol = symbol_short!("ORBTOKEN");
const SLASHED_CALLS: Symbol = symbol_short!("SLSHCALL");

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

#[contracttype]
#[derive(Clone)]
pub enum Event {
    OutcomeSubmitted(u64, bool, u128, BytesN<32>),
    OutcomeOverturned(u64, bool, u128),
    PayoutWithdrawn(u64, Address, u128),
    OracleUpdated(BytesN<32>, bool),
    OracleBondDeposited(BytesN<32>, u128),
    OracleBondSlashed(u64, BytesN<32>, u128, Address),
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
            panic!("Contract is paused");
        }
    }

    fn get_fee_config(env: &Env) -> FeeConfig {
        env.storage()
            .persistent()
            .get(&FEE_CONFIG)
            .expect("Fee config not set")
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
            .expect("Oracle bond token not set")
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

        // Initialize oracle bond balances
        let oracle_bonds: Map<BytesN<32>, u128> = Map::new(&env);
        storage.set(&ORACLE_BONDS, &oracle_bonds);

        // Track the oracle that settled each call
        let call_oracles: Map<u64, BytesN<32>> = Map::new(&env);
        storage.set(&CALL_ORACLES, &call_oracles);

        // Track whether a call has already been slashed after an overturn
        let slashed_calls: Map<u64, bool> = Map::new(&env);
        storage.set(&SLASHED_CALLS, &slashed_calls);

        // Initialize pause flag in persistent storage
        env.storage().persistent().set(&IS_PAUSED, &false);

        env.storage().persistent().set(
            &FEE_CONFIG,
            &FeeConfig {
                basis_points: 0,
                treasury: owner,
            },
        );
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

    pub fn set_oracle_bond_token(env: Env, token: Address) {
        Self::require_owner_auth(&env);
        env.storage().persistent().set(&ORACLE_BOND_TOKEN, &token);
    }

    pub fn get_oracle_bond_token_view(env: Env) -> Option<Address> {
        env.storage().persistent().get(&ORACLE_BOND_TOKEN)
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

    pub fn deposit_oracle_bond(env: Env, oracle: BytesN<32>, amount: u128) {
        Self::assert_not_paused(&env);

        if amount == 0 {
            panic!("Bond amount must be > 0");
        }

        let storage = env.storage().instance();
        let oracles: Map<BytesN<32>, bool> =
            storage.get(&ORACLES).unwrap_or_else(|| Map::new(&env));
        if !oracles.get(oracle.clone()).unwrap_or(false) {
            panic!("Oracle not authorized");
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
            Event::OracleBondDeposited(oracle, amount),
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

    /// Submit outcome with ed25519 signature verification
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

        // Verify call hasn't been settled
        let mut calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));

        if let Some(call_data) = calls.get(call_id) {
            if call_data.settled {
                panic!("Call already settled");
            }
        } else {
            panic!("Call not found");
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
            panic!("Oracle not authorized");
        }

        let bonds: Map<BytesN<32>, u128> =
            storage.get(&ORACLE_BONDS).unwrap_or_else(|| Map::new(&env));
        if bonds.get(oracle_pubkey.clone()).unwrap_or(0) == 0 {
            panic!("Oracle bond required");
        }

        // Mark call as settled
        let mut call_data = calls.get(call_id).unwrap();
        call_data.settled = true;
        call_data.outcome = Some(outcome);
        call_data.final_price = Some(final_price);
        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);

        let mut call_oracles: Map<u64, BytesN<32>> =
            storage.get(&CALL_ORACLES).unwrap_or_else(|| Map::new(&env));
        call_oracles.set(call_id, oracle_pubkey.clone());
        storage.set(&CALL_ORACLES, &call_oracles);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "outcome_submitted"),),
            Event::OutcomeSubmitted(call_id, outcome, final_price, oracle_pubkey),
        );

        true
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
            .unwrap_or_else(|| panic!("Call not found"));

        if !call_data.settled {
            panic!("Call not settled");
        }

        let mut was_overturned = false;
        let existing_outcome = call_data
            .outcome
            .unwrap_or_else(|| panic!("Call outcome missing"));

        if existing_outcome != majority_outcome {
            let mut slashed_calls: Map<u64, bool> = storage
                .get(&SLASHED_CALLS)
                .unwrap_or_else(|| Map::new(&env));

            if slashed_calls.get(call_id).unwrap_or(false) {
                panic!("Call already slashed");
            }

            let call_oracles: Map<u64, BytesN<32>> =
                storage.get(&CALL_ORACLES).unwrap_or_else(|| Map::new(&env));
            let settling_oracle = call_oracles
                .get(call_id)
                .unwrap_or_else(|| panic!("Settling oracle not found"));

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
                    ),
                );
            }

            slashed_calls.set(call_id, true);
            storage.set(&SLASHED_CALLS, &slashed_calls);
            was_overturned = true;
        }

        call_data.outcome = Some(majority_outcome);
        call_data.final_price = Some(majority_final_price);
        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);

        if was_overturned {
            env.events().publish(
                (Symbol::new(&env, "outcome_overturned"),),
                Event::OutcomeOverturned(call_id, majority_outcome, majority_final_price),
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
                panic!("Already withdrawn");
            }
        }

        // Get call data
        let calls: Map<u64, CallData> = storage.get(&CALLS).unwrap_or_else(|| Map::new(&env));
        let call_data = calls
            .get(call_id)
            .unwrap_or_else(|| panic!("Call not found"));

        // Verify call is settled
        if !call_data.settled {
            panic!("Call not settled");
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

    /// Check if user already withdrew from a call
    pub fn has_withdrawn(env: Env, call_id: u64, user: Address) -> bool {
        let storage = env.storage().instance();
        let withdrawals: Map<(u64, Address), bool> =
            storage.get(&WITHDRAWALS).unwrap_or_else(|| Map::new(&env));

        withdrawals.get((call_id, user)).unwrap_or(false)
    }
}

mod test;
