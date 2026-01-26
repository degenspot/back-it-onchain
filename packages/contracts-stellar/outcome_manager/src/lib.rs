#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, Map, Symbol,
};

const OWNER: Symbol = symbol_short!("OWNER");
const ORACLES: Symbol = symbol_short!("ORACLES");
const CALLS: Symbol = symbol_short!("CALLS");
const WITHDRAWALS: Symbol = symbol_short!("WITHDRAW");
const CALL_REGISTRY: Symbol = symbol_short!("CALL_REG");

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
#[derive(Clone)]
pub enum Event {
    OutcomeSubmitted(u64, bool, u128, BytesN<32>),
    PayoutWithdrawn(u64, Address, u128),
    OracleUpdated(BytesN<32>, bool),
}

#[contract]
pub struct OutcomeManagerContract;

#[contractimpl]
impl OutcomeManagerContract {
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
    }

    /// Set oracle authorization status (owner only)
    pub fn set_oracle(env: Env, oracle: BytesN<32>, authorized: bool) {
        let storage = env.storage().instance();
        let owner: Address = storage.get(&OWNER).unwrap();

        owner.require_auth();

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
        oracles.get(oracle).map(|v| v).unwrap_or_else(|| false)
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
        let is_authorized = oracles
            .get(oracle_pubkey.clone())
            .map(|v| v)
            .unwrap_or_else(|| false);

        if !is_authorized {
            panic!("Oracle not authorized");
        }

        // Mark call as settled
        let mut call_data = calls.get(call_id).unwrap();
        call_data.settled = true;
        call_data.outcome = Some(outcome);
        call_data.final_price = Some(final_price);
        calls.set(call_id, call_data);
        storage.set(&CALLS, &calls);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "outcome_submitted"),),
            Event::OutcomeSubmitted(call_id, outcome, final_price, oracle_pubkey),
        );

        true
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
        let payout: u128;

        // Calculate payout based on user's side and outcome
        if user_side == outcome {
            // User won - calculate their share
            let winning_tokens = if outcome {
                call_data.long_tokens
            } else {
                call_data.short_tokens
            };

            let losing_tokens = if outcome {
                call_data.short_tokens
            } else {
                call_data.long_tokens
            };

            // User gets their stake back + their share of losing side
            payout = user_stake + ((user_stake * losing_tokens) / winning_tokens);
        } else {
            // User lost - no payout (their stake is already gone)
            payout = 0;
        }

        // Mark withdrawal as done
        let mut new_withdrawals = withdrawals.clone();
        new_withdrawals.set((call_id, user.clone()), true);
        storage.set(&WITHDRAWALS, &new_withdrawals);

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

        withdrawals
            .get((call_id, user))
            .map(|v| v)
            .unwrap_or_else(|| false)
    }
}

mod test;
