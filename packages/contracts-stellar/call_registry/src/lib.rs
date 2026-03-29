#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, String, Symbol,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Call {
    pub creator: Address,
    pub stake_token: Address,
    pub total_stake_yes: i128,
    pub total_stake_no: i128,
    pub start_ts: u64,
    pub end_ts: u64,
    pub token_address: Address,
    pub pair_id: BytesN<32>,
    pub ipfs_cid: String,
    pub settled: bool,
    pub outcome: bool,
    pub final_price: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreateCallMetadata {
    pub token_address: Address,
    pub pair_id: BytesN<32>,
    pub ipfs_cid: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Call(u64),
    NextCallId,
    UserStake(u64, Address, bool),
    Admin,
    IsPaused,
}

#[contract]
pub struct CallRegistry;

#[contractimpl]
impl CallRegistry {
    fn get_admin(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    fn is_paused(env: &Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    fn assert_not_paused(env: &Env) {
        if Self::is_paused(env) {
            panic!("Contract is paused");
        }
    }

    /// Initialize admin and pause state
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }

        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::IsPaused, &false);
    }

    /// Pause write operations (admin only)
    pub fn pause(env: Env) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::IsPaused, &true);
    }

    /// Resume write operations (admin only)
    pub fn unpause(env: Env) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::IsPaused, &false);
    }

    pub fn get_is_paused(env: Env) -> bool {
        Self::is_paused(&env)
    }

    /// Create a new prediction call
    /// Accepts creator, stake token, stake amount, end timestamp, and call metadata
    /// Transfers stake from creator to contract (escrow)
    /// Stores call data in persistent storage
    /// Emits CallCreated event
    /// Returns the new call ID
    pub fn create_call(
        env: Env,
        creator: Address,
        stake_token: Address,
        stake_amount: i128,
        end_ts: u64,
        metadata: CreateCallMetadata,
    ) -> u64 {
        Self::assert_not_paused(&env);
        creator.require_auth();

        if end_ts <= env.ledger().timestamp() {
            panic!("End time must be in future");
        }
        if stake_amount <= 0 {
            panic!("Stake amount must be > 0");
        }

        // Transfer stake from creator to contract
        let token_client = token::Client::new(&env, &stake_token);
        token_client.transfer(&creator, &env.current_contract_address(), &stake_amount);

        // Get and increment ID
        let call_id = env
            .storage()
            .instance()
            .get(&DataKey::NextCallId)
            .unwrap_or(0u64);
        env.storage()
            .instance()
            .set(&DataKey::NextCallId, &(call_id + 1));

        let start_ts = env.ledger().timestamp();

        let call = Call {
            creator: creator.clone(),
            stake_token: stake_token.clone(),
            total_stake_yes: stake_amount,
            total_stake_no: 0,
            start_ts,
            end_ts,
            token_address: metadata.token_address.clone(),
            pair_id: metadata.pair_id.clone(),
            ipfs_cid: metadata.ipfs_cid.clone(),
            settled: false,
            outcome: false,
            final_price: 0,
        };

        // Store call
        env.storage()
            .persistent()
            .set(&DataKey::Call(call_id), &call);

        // Record creator's stake (YES position)
        env.storage().persistent().set(
            &DataKey::UserStake(call_id, creator.clone(), true),
            &stake_amount,
        );

        // Emit CallCreated event
        // topics: ["CallCreated", call_id, creator]
        // data: (stake_token, stake_amount, start_ts, end_ts, token_address, pair_id, ipfs_cid)
        env.events().publish(
            (Symbol::new(&env, "CallCreated"), call_id, creator),
            (
                stake_token,
                stake_amount,
                start_ts,
                end_ts,
                metadata.token_address,
                metadata.pair_id,
                metadata.ipfs_cid,
            ),
        );

        call_id
    }

    /// Stake on an existing call
    /// Accepts call ID, staker, amount, and position (true=YES, false=NO)
    /// Validates call exists, hasn't ended, and isn't settled
    /// Transfers stake to contract
    /// Updates total_stake_yes or total_stake_no
    /// Emits StakeAdded event
    pub fn stake_on_call(env: Env, call_id: u64, staker: Address, amount: i128, position: bool) {
        Self::assert_not_paused(&env);
        staker.require_auth();

        let key = DataKey::Call(call_id);
        let mut call: Call = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Call does not exist");

        if env.ledger().timestamp() >= call.end_ts {
            panic!("Call ended");
        }
        if call.settled {
            panic!("Call settled");
        }
        if amount <= 0 {
            panic!("Amount must be > 0");
        }

        // Transfer stake
        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&staker, &env.current_contract_address(), &amount);

        // Update totals
        if position {
            call.total_stake_yes += amount;
        } else {
            call.total_stake_no += amount;
        }
        env.storage().persistent().set(&key, &call);

        // Update user stake
        let stake_key = DataKey::UserStake(call_id, staker.clone(), position);
        let current_stake: i128 = env.storage().persistent().get(&stake_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&stake_key, &(current_stake + amount));

        // Emit StakeAdded event
        // topics: ["StakeAdded", call_id, staker]
        // data: (position, amount)
        env.events().publish(
            (Symbol::new(&env, "StakeAdded"), call_id, staker),
            (position, amount),
        );
    }

    pub fn get_call(env: Env, call_id: u64) -> Call {
        env.storage()
            .persistent()
            .get(&DataKey::Call(call_id))
            .expect("Call does not exist")
    }

    pub fn get_user_stake(env: Env, call_id: u64, user: Address, position: bool) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserStake(call_id, user, position))
            .unwrap_or(0)
    }
}
/// Finalize a call and reward the caller with a gas fee
    /// Deducts 0.5% from the losers' pool as a gas fee
    /// Transfers the fee to the address that calls this function
    pub fn finalize_call(
        env: Env,
        call_id: u64,
        outcome: bool,
        final_price: i128,
        caller: Address,
    ) {
        caller.require_auth();

        let key = DataKey::Call(call_id);
        let mut call: Call = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Call does not exist");

        if call.settled {
            panic!("Call already settled");
        }
        if env.ledger().timestamp() < call.end_ts {
            panic!("Call has not ended yet");
        }

        // Determine losers pool
        let losers_pool = if outcome {
            call.total_stake_no
        } else {
            call.total_stake_yes
        };

        // Deduct 0.5% gas fee from losers pool
        let gas_fee = losers_pool * 5 / 1000;

        // Transfer gas fee to caller
        if gas_fee > 0 {
            let token_client = token::Client::new(&env, &call.stake_token);
            token_client.transfer(
                &env.current_contract_address(),
                &caller,
                &gas_fee,
            );
        }

        // Mark call as settled
        call.settled = true;
        call.outcome = outcome;
        call.final_price = final_price;
        env.storage().persistent().set(&key, &call);

        // Emit CallFinalized event
        env.events().publish(
            (Symbol::new(&env, "CallFinalized"), call_id, caller),
            (outcome, final_price, gas_fee),
        );
    }
mod test;

