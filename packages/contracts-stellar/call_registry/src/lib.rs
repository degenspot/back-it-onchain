#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, String, Symbol, Vec,
};

// ── TTL constants (issue #169) ────────────────────────────────────────────────
/// Approximate ledger count for 1 year (≈ 6 s per ledger, 365.25 days).
const LEDGERS_PER_YEAR: u32 = 5_259_600;
/// Re-extend TTL if it falls below 30 days of remaining ledgers.
const TTL_THRESHOLD: u32 = 432_000; // ~30 days

// ── Vault interface (mock / Phoenix-compatible) ───────────────────────────────
// Any Soroban lending vault that exposes deposit/withdraw is compatible.
mod vault {
    use soroban_sdk::{contractclient, Address, Env};

    #[allow(dead_code)]
    #[contractclient(name = "VaultClient")]
    pub trait Vault {
        fn deposit(env: Env, from: Address, amount: i128);
        fn withdraw(env: Env, to: Address, amount: i128);
    }
}

// ── Data types ────────────────────────────────────────────────────────────────

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
    /// Total funds currently deposited in the vault for this call.
    pub vault_balance: i128,
    /// Number of unique participants (used for surge-fee calculation).
    pub participant_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreateCallMetadata {
    pub token_address: Address,
    pub pair_id: BytesN<32>,
    pub ipfs_cid: String,
}

// ── Token whitelisting types (issue #170) ─────────────────────────────────────

/// Tracks a pending token-whitelist proposal with up to 3 staker vouches.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenProposal {
    pub proposer: Address,
    /// Addresses of authorized stakers who have vouched for this token.
    pub vouches: Vec<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Call(u64),
    NextCallId,
    UserStake(u64, Address, bool),
    Admin,
    IsPaused,
    /// Optional vault contract address (set by admin).
    VaultContract,
    /// Accumulated platform fees available for dividend distribution.
    PlatformFees,
    // ── Token whitelist (issue #170) ─────────────────────────────────────────
    /// Whether a given token is whitelisted as a stake_token.
    WhitelistedToken(Address),
    /// Pending proposal for a token, keyed by token address.
    TokenProposal(Address),
    /// Whether an address is an authorized staker (can vouch for tokens).
    AuthorizedStaker(Address),
}

// ── Surge-fee helper ──────────────────────────────────────────────────────────

/// Returns fee in basis points (1 bp = 0.01 %).
/// Base fee: 50 bp (0.5 %).  Each additional 10 participants adds 5 bp, capped at 200 bp (2 %).
///
/// | participants | fee bp |
/// |-------------|--------|
/// | 0–9         | 50     |
/// | 10–19       | 55     |
/// | …           | …      |
/// | ≥300        | 200    |
pub fn compute_fee_basis_points(participant_count: u32) -> i128 {
    const BASE_BPS: i128 = 50;
    const MAX_BPS: i128 = 200;
    const STEP: u32 = 10;
    const BPS_PER_STEP: i128 = 5;

    let steps = (participant_count / STEP) as i128;
    let fee = BASE_BPS + steps * BPS_PER_STEP;
    if fee > MAX_BPS {
        MAX_BPS
    } else {
        fee
    }
}

// ── TTL helper (issue #169) ───────────────────────────────────────────────────

/// Extend a persistent-storage key's TTL to 1 year if it falls below the
/// 30-day threshold.  Call this on every meaningful write to ensure data
/// is retained for 1 year from the most-recent interaction.
fn bump_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, LEDGERS_PER_YEAR);
}

// ── Contract ──────────────────────────────────────────────────────────────────

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

    // ── Token whitelist helpers (issue #170) ──────────────────────────────────

    fn assert_token_whitelisted(env: &Env, token: &Address) {
        let whitelisted: bool = env
            .storage()
            .persistent()
            .get(&DataKey::WhitelistedToken(token.clone()))
            .unwrap_or(false);
        if !whitelisted {
            panic!("Token not whitelisted");
        }
    }

    fn is_authorized_staker_internal(env: &Env, staker: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::AuthorizedStaker(staker.clone()))
            .unwrap_or(false)
    }

    // ── Vault helpers ─────────────────────────────────────────────────────────

    fn vault_contract(env: &Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::VaultContract)
    }

    /// Deposit `amount` into the vault on behalf of the contract.
    fn vault_deposit(env: &Env, stake_token: &Address, amount: i128) {
        if let Some(vault_addr) = Self::vault_contract(env) {
            let client = vault::VaultClient::new(env, &vault_addr);
            // Approve vault to pull funds from this contract first.
            let token_client = token::Client::new(env, stake_token);
            token_client.approve(
                &env.current_contract_address(),
                &vault_addr,
                &amount,
                &(env.ledger().sequence() + 100),
            );
            client.deposit(&env.current_contract_address(), &amount);
        }
    }

    /// Withdraw `amount` from the vault back to this contract.
    fn vault_withdraw(env: &Env, amount: i128) {
        if let Some(vault_addr) = Self::vault_contract(env) {
            let client = vault::VaultClient::new(env, &vault_addr);
            client.withdraw(&env.current_contract_address(), &amount);
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Initialize admin and pause state.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::IsPaused, &false);
    }

    /// Set (or clear) the vault contract address (admin only).
    pub fn set_vault(env: Env, vault: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::VaultContract, &vault);
    }

    pub fn pause(env: Env) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::IsPaused, &true);
    }

    pub fn unpause(env: Env) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::IsPaused, &false);
    }

    pub fn get_is_paused(env: Env) -> bool {
        Self::is_paused(&env)
    }

    // ── Authorized staker management (issue #170) ─────────────────────────────

    /// Grant a staker authorization to vouch for token proposals (admin only).
    pub fn add_authorized_staker(env: Env, staker: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedStaker(staker.clone()), &true);
        env.events()
            .publish((Symbol::new(&env, "StakerAuthorized"), staker), ());
    }

    /// Revoke an authorized staker (admin only).
    pub fn remove_authorized_staker(env: Env, staker: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::AuthorizedStaker(staker.clone()));
        env.events()
            .publish((Symbol::new(&env, "StakerRevoked"), staker), ());
    }

    /// Admin shortcut: directly whitelist a token without the proposal process.
    pub fn whitelist_token_admin(env: Env, token: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::WhitelistedToken(token.clone()), &true);
        // Clean up any pending proposal for this token.
        env.storage()
            .persistent()
            .remove(&DataKey::TokenProposal(token.clone()));
        env.events()
            .publish((Symbol::new(&env, "TokenWhitelisted"), token), ());
    }

    /// Admin can revoke a previously whitelisted token.
    pub fn remove_whitelisted_token(env: Env, token: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::WhitelistedToken(token.clone()));
        env.events()
            .publish((Symbol::new(&env, "TokenDelisted"), token), ());
    }

    // ── Decentralized token whitelisting (issue #170) ─────────────────────────

    /// Any user may propose a token to be used as a stake_token.
    /// If the token is already whitelisted or has an existing proposal, this is a no-op.
    pub fn propose_token(env: Env, proposer: Address, token: Address) {
        proposer.require_auth();

        // Already whitelisted – nothing to do.
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::WhitelistedToken(token.clone()))
            .unwrap_or(false)
        {
            return;
        }

        // Existing proposal – let it proceed through vouching.
        if env
            .storage()
            .persistent()
            .has(&DataKey::TokenProposal(token.clone()))
        {
            return;
        }

        let proposal = TokenProposal {
            proposer: proposer.clone(),
            vouches: Vec::new(&env),
        };
        env.storage()
            .persistent()
            .set(&DataKey::TokenProposal(token.clone()), &proposal);

        env.events()
            .publish((Symbol::new(&env, "TokenProposed"), token), proposer);
    }

    /// An authorized staker vouches for a pending token proposal.
    /// After 3 distinct vouches the token is automatically whitelisted.
    pub fn vouch_for_token(env: Env, voucher: Address, token: Address) {
        voucher.require_auth();

        if !Self::is_authorized_staker_internal(&env, &voucher) {
            panic!("Not an authorized staker");
        }

        let key = DataKey::TokenProposal(token.clone());
        let mut proposal: TokenProposal = env
            .storage()
            .persistent()
            .get(&key)
            .expect("No proposal for token");

        // Idempotent: ignore duplicate vouches from the same staker.
        for i in 0..proposal.vouches.len() {
            if proposal.vouches.get(i).unwrap() == voucher {
                return;
            }
        }

        proposal.vouches.push_back(voucher.clone());
        env.events()
            .publish((Symbol::new(&env, "TokenVouched"), token.clone()), voucher);

        // Three vouches → automatically whitelist.
        if proposal.vouches.len() >= 3 {
            env.storage()
                .persistent()
                .set(&DataKey::WhitelistedToken(token.clone()), &true);
            env.storage().persistent().remove(&key);
            env.events()
                .publish((Symbol::new(&env, "TokenWhitelisted"), token), ());
        } else {
            env.storage().persistent().set(&key, &proposal);
        }
    }

    // ── Token whitelist getters ───────────────────────────────────────────────

    pub fn is_token_whitelisted(env: Env, token: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::WhitelistedToken(token))
            .unwrap_or(false)
    }

    pub fn get_token_proposal(env: Env, token: Address) -> TokenProposal {
        env.storage()
            .persistent()
            .get(&DataKey::TokenProposal(token))
            .expect("No proposal found")
    }

    pub fn is_authorized_staker(env: Env, staker: Address) -> bool {
        Self::is_authorized_staker_internal(&env, &staker)
    }

    // ── Core call lifecycle ───────────────────────────────────────────────────

    /// Create a new prediction call.
    /// Stakes are deposited into the vault (if configured) to earn yield.
    pub fn create_call(
        env: Env,
        creator: Address,
        stake_token: Address,
        stake_amount: i128,
        end_ts: u64,
        metadata: CreateCallMetadata,
    ) -> u64 {
        Self::assert_not_paused(&env);
        // Enforce token whitelist (issue #170)
        Self::assert_token_whitelisted(&env, &stake_token);
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

        // Deposit into vault (issue #159)
        Self::vault_deposit(&env, &stake_token, stake_amount);

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
            vault_balance: stake_amount,
            participant_count: 1,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Call(call_id), &call);

        // Bump TTL for 1 year on creation (issue #169)
        let call_key = DataKey::Call(call_id);
        bump_persistent_ttl(&env, &call_key);

        let creator_stake_key = DataKey::UserStake(call_id, creator.clone(), true);
        env.storage()
            .persistent()
            .set(&creator_stake_key, &stake_amount);
        bump_persistent_ttl(&env, &creator_stake_key);

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

    /// Stake on an existing call.
    /// Applies a dynamic surge fee based on participant count (issue #161).
    /// Net stake (after fee) is deposited into the vault (issue #159).
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

        // Transfer full amount from staker to contract
        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&staker, &env.current_contract_address(), &amount);

        // Dynamic surge fee (issue #161)
        let fee_bps = compute_fee_basis_points(call.participant_count);
        let fee = amount * fee_bps / 10_000;
        let net_amount = amount - fee;

        // Accumulate platform fee for dividend distribution (issue #160)
        if fee > 0 {
            let current_fees: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::PlatformFees)
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::PlatformFees, &(current_fees + fee));
        }

        // Deposit net stake into vault (issue #159)
        Self::vault_deposit(&env, &call.stake_token, net_amount);

        // Update totals with net amount
        if position {
            call.total_stake_yes += net_amount;
        } else {
            call.total_stake_no += net_amount;
        }
        call.vault_balance += net_amount;
        call.participant_count += 1;
        env.storage().persistent().set(&key, &call);
        // Bump TTL on every stake interaction (issue #169)
        bump_persistent_ttl(&env, &key);

        let stake_key = DataKey::UserStake(call_id, staker.clone(), position);
        let current_stake: i128 = env.storage().persistent().get(&stake_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&stake_key, &(current_stake + net_amount));
        bump_persistent_ttl(&env, &stake_key);

        env.events().publish(
            (Symbol::new(&env, "StakeAdded"), call_id, staker),
            (position, net_amount, fee, fee_bps),
        );
    }

    /// Withdraw payout for a settled call.
    /// Withdraws principal from vault before transferring to winner (issue #159).
    pub fn withdraw_payout(env: Env, call_id: u64, user: Address, position: bool) {
        user.require_auth();

        let key = DataKey::Call(call_id);
        let mut call: Call = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Call does not exist");

        if !call.settled {
            panic!("Call not settled");
        }
        if call.outcome != position {
            panic!("Not on winning side");
        }

        let stake_key = DataKey::UserStake(call_id, user.clone(), position);
        let user_stake: i128 = env
            .storage()
            .persistent()
            .get(&stake_key)
            .expect("No stake found");

        if user_stake == 0 {
            panic!("Nothing to withdraw");
        }

        let winners_pool = if position {
            call.total_stake_yes
        } else {
            call.total_stake_no
        };
        let losers_pool = if position {
            call.total_stake_no
        } else {
            call.total_stake_yes
        };

        // Proportional share of losers pool
        let payout = user_stake + (user_stake * losers_pool / winners_pool);

        // Withdraw from vault (issue #159); vault keeps the interest
        Self::vault_withdraw(&env, payout);
        call.vault_balance -= payout;
        env.storage().persistent().set(&key, &call);

        // Remove the fulfilled stake entry to reclaim state rent (issue #169)
        env.storage().persistent().remove(&stake_key);

        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&env.current_contract_address(), &user, &payout);

        env.events().publish(
            (Symbol::new(&env, "PayoutWithdrawn"), call_id, user),
            payout,
        );
    }

    // ── Hedging / Early Exit ──────────────────────────────────────────────────

    /// Allow a user to sell their position back to the pool before the end time
    /// at a discount. The user receives 80% of their stake back, and the remaining
    /// 20% stays in the pool for other winners.
    pub fn exit_early(env: Env, call_id: u64, user: Address) {
        Self::assert_not_paused(&env);
        user.require_auth();

        let key = DataKey::Call(call_id);
        let mut call: Call = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Call does not exist");

        // Call must still be active (not ended, not settled)
        if env.ledger().timestamp() >= call.end_ts {
            panic!("Call ended");
        }
        if call.settled {
            panic!("Call settled");
        }

        // Determine which side the user has a stake on.
        // A user can only exit one side per call (they cannot be on both sides
        // simultaneously in this design — we check YES first, then NO).
        let yes_stake_key = DataKey::UserStake(call_id, user.clone(), true);
        let no_stake_key = DataKey::UserStake(call_id, user.clone(), false);

        let yes_stake: i128 = env.storage().persistent().get(&yes_stake_key).unwrap_or(0);
        let no_stake: i128 = env.storage().persistent().get(&no_stake_key).unwrap_or(0);

        let (position, user_stake) = if yes_stake > 0 {
            (true, yes_stake)
        } else if no_stake > 0 {
            (false, no_stake)
        } else {
            panic!("No stake found");
        };

        // Calculate payout: 80% returned to user, 20% stays in pool
        let refund = user_stake * 80 / 100;
        let remaining = user_stake - refund; // 20% that stays for winners

        // Withdraw refund from vault (issue #159)
        if refund > 0 {
            Self::vault_withdraw(&env, refund);
        }
        call.vault_balance -= refund;

        // Reduce the side total by the full user stake. The `remaining` portion
        // effectively redistributes to the winning side during settlement.
        if position {
            call.total_stake_yes -= user_stake;
        } else {
            call.total_stake_no -= user_stake;
        }

        // Track the 20% penalty as additional pool funds for the *opposite* side.
        // This makes the remaining funds available to winners on the other side.
        if remaining > 0 {
            if position {
                call.total_stake_no += remaining;
            } else {
                call.total_stake_yes += remaining;
            }
        }

        env.storage().persistent().set(&key, &call);
        bump_persistent_ttl(&env, &key);

        // Remove the user's stake entry
        let stake_key = DataKey::UserStake(call_id, user.clone(), position);
        env.storage().persistent().remove(&stake_key);

        // Transfer refund to user
        if refund > 0 {
            let token_client = token::Client::new(&env, &call.stake_token);
            token_client.transfer(&env.current_contract_address(), &user, &refund);
        }

        env.events().publish(
            (Symbol::new(&env, "EarlyExit"), call_id, user),
            (position, user_stake, refund, remaining),
        );
    }

    // ── Storage archival (issue #169) ─────────────────────────────────────────

    /// Explicitly remove a fully-settled call's storage entry to reclaim state rent.
    /// Anyone may call this once the call is settled; the TTL will expire naturally
    /// after one year, but this allows immediate cleanup.
    pub fn archive_call(env: Env, call_id: u64) {
        let key = DataKey::Call(call_id);
        let call: Call = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Call does not exist");

        if !call.settled {
            panic!("Call not yet settled");
        }

        env.storage().persistent().remove(&key);

        env.events()
            .publish((Symbol::new(&env, "CallArchived"), call_id), ());
    }

    // ── Dividend distribution (issue #160) ────────────────────────────────────

    /// Distribute accumulated platform fees proportionally to governance token holders.
    /// `stakers` is a list of (address, governance_token_balance) pairs.
    /// The treasury (admin) keeps the interest earned by the vault; only explicit
    /// platform fees collected via surge pricing are distributed here.
    pub fn distribute_dividends(env: Env, stake_token: Address, stakers: Vec<(Address, i128)>) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        let total_fees: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PlatformFees)
            .unwrap_or(0);

        if total_fees == 0 {
            panic!("No fees to distribute");
        }

        // Compute total governance weight
        let mut total_weight: i128 = 0;
        for i in 0..stakers.len() {
            let (_, weight) = stakers.get(i).unwrap();
            total_weight += weight;
        }
        if total_weight == 0 {
            panic!("Total weight is zero");
        }

        let token_client = token::Client::new(&env, &stake_token);

        for i in 0..stakers.len() {
            let (addr, weight) = stakers.get(i).unwrap();
            let share = total_fees * weight / total_weight;
            if share > 0 {
                token_client.transfer(&env.current_contract_address(), &addr, &share);
            }
        }

        // Reset accumulated fees
        env.storage()
            .persistent()
            .set(&DataKey::PlatformFees, &0i128);

        env.events().publish(
            (Symbol::new(&env, "DividendsDistributed"),),
            (total_fees, total_weight),
        );
    }

    // ── Finalize ──────────────────────────────────────────────────────────────

    /// Finalize a call. Deducts a gas fee from the losers' pool.
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

        let losers_pool = if outcome {
            call.total_stake_no
        } else {
            call.total_stake_yes
        };

        let gas_fee = losers_pool * 5 / 1000;

        if gas_fee > 0 {
            // Withdraw gas fee from vault before paying caller
            Self::vault_withdraw(&env, gas_fee);
            call.vault_balance -= gas_fee;
            let token_client = token::Client::new(&env, &call.stake_token);
            token_client.transfer(&env.current_contract_address(), &caller, &gas_fee);
        }

        call.settled = true;
        call.outcome = outcome;
        call.final_price = final_price;
        env.storage().persistent().set(&key, &call);

        env.events().publish(
            (Symbol::new(&env, "CallFinalized"), call_id, caller),
            (outcome, final_price, gas_fee),
        );
    }

    // ── Getters ───────────────────────────────────────────────────────────────

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

    pub fn get_platform_fees(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::PlatformFees)
            .unwrap_or(0)
    }

    pub fn get_fee_basis_points(env: Env, call_id: u64) -> i128 {
        let call: Call = env
            .storage()
            .persistent()
            .get(&DataKey::Call(call_id))
            .expect("Call does not exist");
        compute_fee_basis_points(call.participant_count)
    }
}

mod test;
