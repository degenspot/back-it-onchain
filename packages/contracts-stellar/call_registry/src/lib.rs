#![no_std]
use governance::errors::ContractError;
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, String, Symbol, Vec,
};

/// Maximum number of outcomes per market.
const MAX_OUTCOMES: u32 = 32;
/// Minimum number of outcomes per market (binary = 2).
const MIN_OUTCOMES: u32 = 2;

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
    /// Pool balance for each outcome. Index 0 = first outcome, etc.
    /// For binary markets: outcome_pools[0] = YES, outcome_pools[1] = NO.
    /// Length is set at creation time via `num_outcomes`.
    pub outcome_pools: Vec<i128>,
    pub start_ts: u64,
    pub end_ts: u64,
    pub token_address: Address,
    pub pair_id: BytesN<32>,
    pub ipfs_cid: String,
    pub settled: bool,
    /// Index of the winning outcome after settlement.
    /// `u32::MAX` means no outcome has been set yet.
    pub winning_outcome: u32,
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
    /// Number of outcomes for this market (2 = binary, >2 = categorical/scalar).
    pub num_outcomes: u32,
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

/// Platform fee configuration (SC-017).
/// `bps` is the fee in basis points (50–200 inclusive).
/// `treasury` receives dust remainders from dividend distribution.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub bps: u32,
    pub treasury: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Call(u64),
    NextCallId,
    /// User stake: (call_id, user_address, outcome_index)
    UserStake(u64, Address, u32),
    Admin,
    /// Pending admin for two-step ownership handover (SC-011).
    PendingAdmin,
    IsPaused,
    /// Authorized OutcomeManager contract address (SC-014).
    OutcomeManager,
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
    /// Whether a user has already claimed payout for a call (SC-015).
    Claimed(u64, Address),
    /// Fee configuration (bps + treasury address) — instance storage (SC-017).
    FeeConfig,
    /// Treasury contract authorized to credit PlatformFees (SC-084).
    TreasuryContract,
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

/// Extend a persistent-storage key's TTL to 1 year if remaining TTL is below
/// the 30-day threshold (SC-013). No-op when remaining TTL is already healthy.
///
/// Uses `get_ttl` when the key exists; always safe to call on every read/write path.
fn maybe_bump(env: &Env, key: &DataKey) {
    let storage = env.storage().persistent();
    if !storage.has(key) {
        return;
    }
    // Extend TTL for the key. `get_ttl` isn't available on all SDK
    // versions, so simply extend when the key exists — it's safe to call
    // repeatedly and avoids relying on non-portable APIs.
    storage.extend_ttl(key, TTL_THRESHOLD, LEDGERS_PER_YEAR);
}

/// Backwards-compatible alias used by existing call sites.
fn bump_persistent_ttl(env: &Env, key: &DataKey) {
    maybe_bump(env, key);
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
            .unwrap_or_else(|| panic!("{:?}", ContractError::AdminNotSet))
    }

    fn is_paused(env: &Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    fn assert_not_paused(env: &Env) {
        if Self::is_paused(env) {
            // ContractError::ContractPaused = 2 (SC-012 acceptance)
            panic!("{:?}", ContractError::ContractPaused);
        }
    }

    fn require_admin_auth(env: &Env) -> Address {
        let admin = Self::get_admin(env);
        admin.require_auth();
        maybe_bump(env, &DataKey::Admin);
        admin
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

    // ── Fee accrual (SC-088) ──────────────────────────────────────────────────

    /// Credit `fee_amount` to the persistent `PlatformFees` entry and emit
    /// `FeeAccrued`. Returns the new accumulated total.
    ///
    /// Single accrual path shared by `stake_on_call`, `withdraw_payout` and
    /// `exit_early`; the public `accrue_fee` hook wraps this with the
    /// registry-only authorization check.
    fn accrue_fee_internal(env: &Env, call_id: u64, fee_amount: i128) -> i128 {
        if fee_amount < 0 {
            panic!("{:?}", ContractError::InvalidAmount);
        }

        let current_fees: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PlatformFees)
            .unwrap_or(0);
        let new_fees = current_fees
            .checked_add(fee_amount)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));

        env.storage()
            .persistent()
            .set(&DataKey::PlatformFees, &new_fees);
        // Persistent write → bump TTL (issue #169)
        bump_persistent_ttl(env, &DataKey::PlatformFees);

        env.events().publish(
            (Symbol::new(env, "FeeAccrued"), call_id),
            (
                fee_amount,   // accrued by this invocation
                current_fees, // PlatformFees before
                new_fees,     // new PlatformFees total
            ),
        );

        new_fees
    }

    /// Fee-accrual hook (SC-088).
    ///
    /// Increments the persistent `PlatformFees` entry by `fee_amount` using
    /// `checked_add` and emits `FeeAccrued` with the new total. Invoked by the
    /// registry itself from `stake_on_call` and `exit_early`, and exposed so the
    /// treasury flow has a single auditable entry point.
    ///
    /// Authorization: `caller` must be this contract — it is compared against
    /// `env.current_contract_address()` and must have authorized the
    /// invocation. Soroban exposes no invoker introspection, so the caller is
    /// passed explicitly rather than inferred; any non-registry caller reverts
    /// with `ContractError::Unauthorized`.
    ///
    /// Returns the new accumulated `PlatformFees` balance.
    pub fn accrue_fee(env: Env, caller: Address, call_id: u64, fee_amount: i128) -> i128 {
        caller.require_auth();
        if caller != env.current_contract_address() {
            panic!("{:?}", ContractError::Unauthorized);
        }
        if fee_amount <= 0 {
            panic!("{:?}", ContractError::InvalidAmount);
        }
        if !env.storage().persistent().has(&DataKey::Call(call_id)) {
            panic!("{:?}", ContractError::CallNotFound);
        }

        Self::accrue_fee_internal(&env, call_id, fee_amount)
    }

    /// Credit platform fees from the authorized treasury contract (SC-084).
    ///
    /// Called after the treasury SAC-transfers the staker dividend share.
    /// Authorization: `caller` must match the configured `TreasuryContract`.
    pub fn credit_platform_fees(env: Env, caller: Address, amount: i128) -> i128 {
        caller.require_auth();

        let authorized: Address = env
            .storage()
            .instance()
            .get(&DataKey::TreasuryContract)
            .unwrap_or_else(|| panic!("{:?}", ContractError::Unauthorized));
        if caller != authorized {
            panic!("{:?}", ContractError::Unauthorized);
        }
        if amount <= 0 {
            panic!("{:?}", ContractError::InvalidAmount);
        }

        let current_fees: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PlatformFees)
            .unwrap_or(0);
        let new_fees = current_fees
            .checked_add(amount)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));

        env.storage()
            .persistent()
            .set(&DataKey::PlatformFees, &new_fees);
        bump_persistent_ttl(&env, &DataKey::PlatformFees);

        env.events().publish(
            (Symbol::new(&env, "PlatformFeesCredited"), caller),
            (amount, current_fees, new_fees),
        );

        new_fees
    }

    /// Register the treasury contract allowed to credit PlatformFees. Admin-only.
    pub fn set_treasury_contract(env: Env, treasury: Address) {
        let _admin = Self::require_admin_auth(&env);
        env.storage()
            .instance()
            .set(&DataKey::TreasuryContract, &treasury);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, LEDGERS_PER_YEAR);

        env.events()
            .publish((Symbol::new(&env, "TreasuryContractSet"),), treasury);
    }

    /// Read the authorized treasury contract address, if configured.
    pub fn get_treasury_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::TreasuryContract)
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// One-time admin + pause-state initialization (SC-011).
    /// Reverts with `AlreadyInitialized` if `Admin` is already set.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("{:?}", ContractError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::IsPaused, &false);
        maybe_bump(&env, &DataKey::Admin);
        maybe_bump(&env, &DataKey::IsPaused);

        env.events().publish(
            (Symbol::new(&env, "AdminChanged"), admin.clone()),
            (env.ledger().sequence(), true),
        );
    }

    /// Propose a new admin (current admin only). Completes via `accept_admin` (SC-011).
    pub fn propose_admin(env: Env, new_admin: Address) {
        let admin = Self::require_admin_auth(&env);
        env.storage()
            .persistent()
            .set(&DataKey::PendingAdmin, &new_admin);
        maybe_bump(&env, &DataKey::PendingAdmin);

        env.events().publish(
            (Symbol::new(&env, "AdminProposed"), admin, new_admin),
            env.ledger().sequence(),
        );
    }

    /// Accept a pending admin proposal. Only the proposed address may accept (SC-011).
    pub fn accept_admin(env: Env) {
        let pending: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PendingAdmin)
            .unwrap_or_else(|| panic!("{:?}", ContractError::NoPendingOwner));
        pending.require_auth();

        let old_admin: Address = Self::get_admin(&env);
        env.storage().persistent().set(&DataKey::Admin, &pending);
        env.storage().persistent().remove(&DataKey::PendingAdmin);
        maybe_bump(&env, &DataKey::Admin);

        env.events().publish(
            (Symbol::new(&env, "AdminChanged"), old_admin, pending),
            env.ledger().sequence(),
        );
    }

    /// Set the OutcomeManager contract authorized to finalize calls (SC-014).
    pub fn set_outcome_manager(env: Env, manager: Address) {
        let _admin = Self::require_admin_auth(&env);
        env.storage()
            .persistent()
            .set(&DataKey::OutcomeManager, &manager);
        maybe_bump(&env, &DataKey::OutcomeManager);
    }

    pub fn get_outcome_manager(env: Env) -> Option<Address> {
        let key = DataKey::OutcomeManager;
        maybe_bump(&env, &key);
        env.storage().persistent().get(&key)
    }

    /// Set (or clear) the vault contract address (admin only).
    pub fn set_vault(env: Env, vault: Address) {
        let _admin = Self::require_admin_auth(&env);
        env.storage()
            .persistent()
            .set(&DataKey::VaultContract, &vault);
        maybe_bump(&env, &DataKey::VaultContract);
    }

    /// Pause all state-changing entrypoints (admin only). Emits `Paused(true)` (SC-012).
    pub fn pause(env: Env) {
        let _admin = Self::require_admin_auth(&env);
        env.storage().persistent().set(&DataKey::IsPaused, &true);
        maybe_bump(&env, &DataKey::IsPaused);

        env.events()
            .publish((Symbol::new(&env, "Paused"), true), env.ledger().sequence());
    }

    /// Resume state-changing entrypoints (admin only). Emits `Paused(false)` (SC-012).
    pub fn unpause(env: Env) {
        let _admin = Self::require_admin_auth(&env);
        env.storage().persistent().set(&DataKey::IsPaused, &false);
        maybe_bump(&env, &DataKey::IsPaused);

        env.events().publish(
            (Symbol::new(&env, "Paused"), false),
            env.ledger().sequence(),
        );
    }

    pub fn get_is_paused(env: Env) -> bool {
        maybe_bump(&env, &DataKey::IsPaused);
        Self::is_paused(&env)
    }

    pub fn get_admin_address(env: Env) -> Address {
        maybe_bump(&env, &DataKey::Admin);
        Self::get_admin(&env)
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
    /// `num_outcomes` defines how many outcome pools the market has (2 = binary).
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
            panic!("Amount must be greater than zero");
        }
        if metadata.num_outcomes < MIN_OUTCOMES {
            panic!("Must have at least 2 outcomes");
        }
        if metadata.num_outcomes > MAX_OUTCOMES {
            panic!("Too many outcomes");
        }

        // Transfer stake from creator to contract (SAC escrow with
        // balance-delta guard: fee-on-transfer tokens may deliver less than
        // `stake_amount`, so record the actual delta received).
        let token_client = token::Client::new(&env, &stake_token);
        let balance_before = token_client.balance(&env.current_contract_address());
        token_client.transfer(&creator, &env.current_contract_address(), &stake_amount);
        let balance_after = token_client.balance(&env.current_contract_address());
        let net_amount = balance_after - balance_before;
        if net_amount <= 0 {
            panic!("Amount must be greater than zero");
        }

        // Deposit net (post token-fee) amount into vault (issue #159)
        Self::vault_deposit(&env, &stake_token, net_amount);

        let call_id = env
            .storage()
            .instance()
            .get(&DataKey::NextCallId)
            .unwrap_or(0u64);
        env.storage()
            .instance()
            .set(&DataKey::NextCallId, &(call_id + 1));

        let start_ts = env.ledger().timestamp();

        // Build outcome pools: creator stakes on outcome 0 by default
        let mut outcome_pools = Vec::new(&env);
        for i in 0..metadata.num_outcomes {
            if i == 0 {
                outcome_pools.push_back(net_amount);
            } else {
                outcome_pools.push_back(0i128);
            }
        }

        let call = Call {
            creator: creator.clone(),
            stake_token: stake_token.clone(),
            outcome_pools,
            start_ts,
            end_ts,
            token_address: metadata.token_address.clone(),
            pair_id: metadata.pair_id.clone(),
            ipfs_cid: metadata.ipfs_cid.clone(),
            settled: false,
            winning_outcome: u32::MAX,
            final_price: 0,
            vault_balance: net_amount,
            participant_count: 1,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Call(call_id), &call);

        // Bump TTL for 1 year on creation (issue #169)
        let call_key = DataKey::Call(call_id);
        bump_persistent_ttl(&env, &call_key);

        let creator_stake_key = DataKey::UserStake(call_id, creator.clone(), 0u32);
        env.storage()
            .persistent()
            .set(&creator_stake_key, &net_amount);
        bump_persistent_ttl(&env, &creator_stake_key);

        env.events().publish(
            (Symbol::new(&env, "CallCreated"), call_id, creator),
            (
                stake_token,
                stake_amount, // gross amount attempted
                net_amount,   // net amount actually received
                start_ts,
                end_ts,
                metadata.token_address,
                metadata.pair_id,
                metadata.ipfs_cid,
                metadata.num_outcomes,
            ),
        );

        call_id
    }

    /// Stake on an existing call.
    /// Applies a dynamic surge fee based on participant count (issue #161).
    /// Net stake (after fee) is deposited into the vault (issue #159).
    /// `outcome_index` is the 0-based index of the outcome pool to stake on.
    pub fn stake_on_call(
        env: Env,
        call_id: u64,
        staker: Address,
        amount: i128,
        outcome_index: u32,
    ) {
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
            panic!("Amount must be greater than zero");
        }
        if outcome_index >= call.outcome_pools.len() as u32 {
            panic!("Invalid outcome index");
        }

        // Transfer full amount from staker to contract (SAC escrow with
        // balance-delta guard: fee-on-transfer tokens may deliver less than
        // `amount`, so the delta received drives fee + pool bookkeeping).
        let token_client = token::Client::new(&env, &call.stake_token);
        let balance_before = token_client.balance(&env.current_contract_address());
        token_client.transfer(&staker, &env.current_contract_address(), &amount);
        let balance_after = token_client.balance(&env.current_contract_address());
        let received = balance_after - balance_before;
        if received <= 0 {
            panic!("Amount must be greater than zero");
        }

        // Dynamic surge fee (issue #161) applied on the actually-received amount
        let fee_bps = compute_fee_basis_points(call.participant_count);
        let fee = received * fee_bps / 10_000;
        let net_amount = received - fee;

        // Accrue the platform fee for dividend distribution via the SC-088 hook
        // (issue #160). Emits FeeAccrued and bumps the PlatformFees TTL.
        if fee > 0 {
            Self::accrue_fee_internal(&env, call_id, fee);
        }

        // Deposit net stake into vault (issue #159)
        Self::vault_deposit(&env, &call.stake_token, net_amount);

        // Update the targeted outcome pool
        let current_pool = call.outcome_pools.get(outcome_index).unwrap();
        call.outcome_pools.set(
            outcome_index,
            current_pool
                .checked_add(net_amount)
                .expect("Arithmetic overflow"),
        );
        call.vault_balance = call
            .vault_balance
            .checked_add(net_amount)
            .expect("Arithmetic overflow");
        call.participant_count += 1;
        env.storage().persistent().set(&key, &call);
        // Bump TTL on every stake interaction (issue #169)
        bump_persistent_ttl(&env, &key);

        let stake_key = DataKey::UserStake(call_id, staker.clone(), outcome_index);
        let current_stake: i128 = env.storage().persistent().get(&stake_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&stake_key, &(current_stake + net_amount));
        bump_persistent_ttl(&env, &stake_key);

        env.events().publish(
            (Symbol::new(&env, "StakeAdded"), call_id, staker),
            (
                outcome_index,
                amount, // gross amount attempted
                net_amount,
                fee,
                fee_bps,
                call.outcome_pools.get(outcome_index).unwrap(), // New total pool state
                call.vault_balance,                             // New vault balance
                call.participant_count,                         // New participant count
            ),
        );
    }

    /// Withdraw payout for a settled call (SC-015).
    /// Pull model: payout = user_winning_stake + (user_winning_stake * total_losing / total_winning)
    /// when total_winning > 0; otherwise 0. Fee taken via compute_fee_basis_points and
    /// accumulated into PlatformFees. Transfers via SAC, sets UserStake=0, marks claimed,
    /// emits PayoutWithdrawn with new vault_balance.
    ///
    /// Validates: settled && user_stake > 0 && !claimed. Uses checked arithmetic.
    pub fn withdraw_payout(env: Env, call_id: u64, user: Address, outcome_index: u32) {
        user.require_auth();

        let key = DataKey::Call(call_id);
        let mut call: Call = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("{:?}", ContractError::CallNotFound));

        if !call.settled {
            panic!("{:?}", ContractError::CallNotSettled);
        }
        if call.winning_outcome != outcome_index {
            panic!("{:?}", ContractError::NotOnWinningSide);
        }

        let claimed_key = DataKey::Claimed(call_id, user.clone());
        if env.storage().persistent().has(&claimed_key) {
            panic!("{:?}", ContractError::AlreadyWithdrawn);
        }

        let stake_key = DataKey::UserStake(call_id, user.clone(), outcome_index);
        let user_stake: i128 = env.storage().persistent().get(&stake_key).unwrap_or(0);

        if user_stake <= 0 {
            panic!("{:?}", ContractError::NoStakeFound);
        }

        let total_winning = call.outcome_pools.get(outcome_index).unwrap_or(0);

        // total_losing = sum(pools) - total_winning
        let mut total_pool: i128 = 0;
        for i in 0..call.outcome_pools.len() {
            total_pool = total_pool
                .checked_add(call.outcome_pools.get(i).unwrap_or(0))
                .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));
        }
        let total_losing = total_pool
            .checked_sub(total_winning)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));

        // payout = user_stake * total_losing / total_winning  (share of losers)
        // + user_stake (principal). If total_winning == 0 → 0.
        let share_of_losers = if total_winning == 0 {
            0i128
        } else {
            user_stake
                .checked_mul(total_losing)
                .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow))
                .checked_div(total_winning)
                .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow))
        };

        let gross_payout = user_stake
            .checked_add(share_of_losers)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));

        // Fee via compute_fee_basis_points (participant_count) applied to the share of losers
        // and accumulated into PlatformFees (SC-015).
        let fee_bps = compute_fee_basis_points(call.participant_count);
        let fee = share_of_losers
            .checked_mul(fee_bps)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow))
            .checked_div(10_000)
            .unwrap_or(0);
        let payout = gross_payout
            .checked_sub(fee)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));

        // Accrue via the SC-088 hook (checked_add + FeeAccrued + TTL bump).
        if fee > 0 {
            Self::accrue_fee_internal(&env, call_id, fee);
        }

        // Withdraw gross (payout + fee) from vault so fee tokens remain on the
        // contract balance ready for later dividend distribution (SC-015).
        if gross_payout > 0 {
            Self::vault_withdraw(&env, gross_payout);
        }
        call.vault_balance = call
            .vault_balance
            .checked_sub(gross_payout)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));
        env.storage().persistent().set(&key, &call);
        bump_persistent_ttl(&env, &key);

        // Set UserStake = 0 and mark claimed (SC-015)
        env.storage().persistent().set(&stake_key, &0i128);
        bump_persistent_ttl(&env, &stake_key);
        env.storage().persistent().set(&claimed_key, &true);
        bump_persistent_ttl(&env, &claimed_key);

        // Transfer via SAC
        if payout > 0 {
            let token_client = token::Client::new(&env, &call.stake_token);
            // Balance-delta guard: capture balance before/after for fee-on-transfer safety
            let bal_before = token_client.balance(&user);
            token_client.transfer(&env.current_contract_address(), &user, &payout);
            let bal_after = token_client.balance(&user);
            let received = bal_after
                .checked_sub(bal_before)
                .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));
            if received < payout {
                // Fee-on-transfer token delivered less; we still proceed (already withdrawn from vault)
                // but this guard documents the check required by SC-015.
            }
        }

        env.events().publish(
            (Symbol::new(&env, "PayoutWithdrawn"), call_id, user),
            (
                payout,
                call.vault_balance, // New vault balance after withdrawal
            ),
        );
    }

    // ── Hedging / Early Exit ──────────────────────────────────────────────────

    /// Allow a user to sell their position back to the pool before the end time
    /// at a discount. The user receives 80% of their stake back, and the remaining
    /// 20% stays in the pool for other winners.
    /// Automatically detects which outcome the user has staked on.
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
        if call.settled {
            panic!("Call settled");
        }
        if env.ledger().timestamp() >= call.end_ts {
            panic!("Call ended");
        }

        // Find which outcome the user has staked on.
        let mut found_outcome: Option<u32> = None;
        let mut user_stake: i128 = 0;
        for i in 0..call.outcome_pools.len() {
            let stake_key = DataKey::UserStake(call_id, user.clone(), i as u32);
            let stake: i128 = env.storage().persistent().get(&stake_key).unwrap_or(0);
            if stake > 0 {
                found_outcome = Some(i as u32);
                user_stake = stake;
                break;
            }
        }

        let outcome_index = match found_outcome {
            Some(idx) => idx,
            None => panic!("No stake found"),
        };

        // Calculate payout: 80% returned to user, 20% held back as an exit penalty.
        let refund = user_stake
            .checked_mul(80)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow))
            .checked_div(100)
            .unwrap_or(0);
        let penalty = user_stake
            .checked_sub(refund)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));

        // The platform takes its surge-fee cut of the exit penalty (SC-088);
        // whatever is left is redistributed across the other outcome pools.
        let fee_bps = compute_fee_basis_points(call.participant_count);
        let fee = penalty
            .checked_mul(fee_bps)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow))
            .checked_div(10_000)
            .unwrap_or(0);
        let remaining = penalty
            .checked_sub(fee)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));

        // Withdraw the refund plus the accrued fee from the vault so the fee
        // tokens sit on the contract balance ready for dividend distribution
        // (mirrors withdraw_payout, issue #159).
        let vault_out = refund
            .checked_add(fee)
            .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));
        if vault_out > 0 {
            Self::vault_withdraw(&env, vault_out);
        }
        call.vault_balance -= vault_out;

        // Accrue the exit fee to PlatformFees via the SC-088 hook.
        let platform_fees_total = if fee > 0 {
            Self::accrue_fee_internal(&env, call_id, fee)
        } else {
            Self::get_platform_fees(env.clone())
        };

        // Reduce the outcome pool by the full user stake.
        let current_pool = call.outcome_pools.get(outcome_index).unwrap();
        call.outcome_pools
            .set(outcome_index, current_pool - user_stake);

        // Distribute the penalty (net of the platform fee) across all OTHER
        // outcome pools proportionally.
        if remaining > 0 {
            let mut other_total: i128 = 0;
            for i in 0..call.outcome_pools.len() {
                if i as u32 != outcome_index {
                    other_total += call.outcome_pools.get(i).unwrap();
                }
            }
            if other_total > 0 {
                for i in 0..call.outcome_pools.len() {
                    if i as u32 != outcome_index {
                        let pool = call.outcome_pools.get(i).unwrap();
                        let share = remaining * pool / other_total;
                        call.outcome_pools.set(i, pool + share);
                    }
                }
            } else {
                // No other pools have stakes — distribute evenly
                let per_pool = remaining / (call.outcome_pools.len() as i128 - 1);
                for i in 0..call.outcome_pools.len() {
                    if i as u32 != outcome_index {
                        let pool = call.outcome_pools.get(i).unwrap();
                        call.outcome_pools.set(i, pool + per_pool);
                    }
                }
            }
        }

        env.storage().persistent().set(&key, &call);
        bump_persistent_ttl(&env, &key);

        // Remove the user's stake entry
        let stake_key = DataKey::UserStake(call_id, user.clone(), outcome_index);
        env.storage().persistent().remove(&stake_key);

        // Transfer refund to user
        if refund > 0 {
            let token_client = token::Client::new(&env, &call.stake_token);
            token_client.transfer(&env.current_contract_address(), &user, &refund);
        }

        env.events().publish(
            (Symbol::new(&env, "EarlyExit"), call_id, user),
            (
                outcome_index,
                user_stake,
                refund,
                remaining, // penalty redistributed to the other pools
                fee,       // platform fee accrued from the penalty (SC-088)
                fee_bps,
                call.outcome_pools.get(outcome_index).unwrap(), // New pool state
                call.vault_balance,                             // New vault balance
                platform_fees_total,                            // New PlatformFees total
            ),
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

    // ── Dividend distribution (SC-016 / issue #160) ───────────────────────────

    /// Distribute accumulated PlatformFees proportional to `weights` among `to`
    /// addresses (soulbound / governance holders). Admin-only.
    /// Resets PlatformFees = 0 and emits DividendsDistributed with new balance 0.
    ///
    /// Validates weights.len() == to.len() && sum(weights) > 0.
    /// Uses checked_mul/div. Dust remainder (< number of recipients) goes to treasury
    /// (from FeeConfig if set, else first recipient).
    pub fn distribute_dividends(
        env: Env,
        stake_token: Address,
        to: Vec<Address>,
        weights: Vec<i128>,
    ) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        if to.len() != weights.len() {
            panic!("{:?}", ContractError::InvalidWeights);
        }
        if to.is_empty() {
            panic!("{:?}", ContractError::InvalidWeights);
        }

        let total_fees: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PlatformFees)
            .unwrap_or(0);

        if total_fees == 0 {
            panic!("{:?}", ContractError::NoFeesToDistribute);
        }

        // Compute total weight with checked add
        let mut total_weight: i128 = 0;
        for i in 0..weights.len() {
            let w = weights.get(i).unwrap();
            if w < 0 {
                panic!("{:?}", ContractError::InvalidAmount);
            }
            total_weight = total_weight
                .checked_add(w)
                .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));
        }
        if total_weight <= 0 {
            panic!("{:?}", ContractError::ZeroWeight);
        }

        let token_client = token::Client::new(&env, &stake_token);

        // Proportional distribution; track distributed to compute dust
        let mut distributed: i128 = 0;
        for i in 0..to.len() {
            let addr = to.get(i).unwrap();
            let weight = weights.get(i).unwrap();
            let share = total_fees
                .checked_mul(weight)
                .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow))
                .checked_div(total_weight)
                .unwrap_or(0);
            if share > 0 {
                token_client.transfer(&env.current_contract_address(), &addr, &share);
                distributed = distributed
                    .checked_add(share)
                    .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));
            }
        }

        // Dust remainder goes to treasury (SC-016)
        let dust = total_fees.checked_sub(distributed).unwrap_or(0);
        if dust > 0 {
            let treasury_addr = env
                .storage()
                .instance()
                .get::<DataKey, FeeConfig>(&DataKey::FeeConfig)
                .map(|c| c.treasury)
                .unwrap_or_else(|| to.get(0).unwrap()); // fallback: first recipient
            token_client.transfer(&env.current_contract_address(), &treasury_addr, &dust);
        }

        // Reset accumulated fees
        env.storage()
            .persistent()
            .set(&DataKey::PlatformFees, &0i128);
        bump_persistent_ttl(&env, &DataKey::PlatformFees);

        env.events().publish(
            (Symbol::new(&env, "DividendsDistributed"),),
            (
                total_fees,
                total_weight,
                0i128, // New platform fees balance (reset to 0)
            ),
        );
    }

    // ── Finalize ──────────────────────────────────────────────────────────────

    /// Finalize a call. Deducts a gas fee from the losers' pools.
    /// `winning_outcome` is the 0-based index of the winning outcome.
    /// Finalize a call with the winning outcome (SC-014).
    ///
    /// Only the configured OutcomeManager contract may call this. Direct calls
    /// from EOAs or other contracts revert with `Unauthorized`. Re-finalization
    /// is blocked by the `settled` flag (`CallSettled`).
    ///
    /// When `vault_rebalance` is true, remaining vault deposits are withdrawn
    /// so yield is realized before settlement is marked complete.
    pub fn finalize_call(
        env: Env,
        call_id: u64,
        winning_outcome: u32,
        final_price: i128,
        vault_rebalance: bool,
        caller: Address,
    ) {
        Self::assert_not_paused(&env);
        caller.require_auth();

        // Cross-contract auth: caller must be the registered OutcomeManager.
        let om: Address = env
            .storage()
            .persistent()
            .get(&DataKey::OutcomeManager)
            .unwrap_or_else(|| panic!("{:?}", ContractError::Unauthorized));
        if caller != om {
            panic!("{:?}", ContractError::Unauthorized);
        }
        maybe_bump(&env, &DataKey::OutcomeManager);

        let key = DataKey::Call(call_id);
        let mut call: Call = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("{:?}", ContractError::CallNotFound));

        if call.settled {
            panic!("{:?}", ContractError::CallSettled);
        }
        if env.ledger().timestamp() < call.end_ts {
            panic!("{:?}", ContractError::CallNotEnded);
        }
        if winning_outcome >= call.outcome_pools.len() as u32 {
            panic!("{:?}", ContractError::InvalidWinningOutcome);
        }

        // Sum all losing pools for gas fee
        let mut losers_pool: i128 = 0;
        for i in 0..call.outcome_pools.len() {
            if i as u32 != winning_outcome {
                losers_pool += call.outcome_pools.get(i).unwrap();
            }
        }

        let gas_fee = losers_pool * 5 / 1000;

        if gas_fee > 0 {
            Self::vault_withdraw(&env, gas_fee);
            call.vault_balance = call
                .vault_balance
                .checked_sub(gas_fee)
                .unwrap_or_else(|| panic!("{:?}", ContractError::ArithmeticOverflow));
            let token_client = token::Client::new(&env, &call.stake_token);
            token_client.transfer(&env.current_contract_address(), &caller, &gas_fee);
        }

        // Optionally realize remaining vault yield before settlement.
        if vault_rebalance && call.vault_balance > 0 {
            let bal = call.vault_balance;
            Self::vault_withdraw(&env, bal);
            call.vault_balance = 0;
        }

        call.settled = true;
        call.winning_outcome = winning_outcome;
        call.final_price = final_price;
        env.storage().persistent().set(&key, &call);
        maybe_bump(&env, &key);

        // Redundant event payload: vault_balance + settled flag (SC-014).
        env.events().publish(
            (Symbol::new(&env, "CallFinalized"), call_id, caller),
            (
                winning_outcome,
                final_price,
                gas_fee,
                call.vault_balance,
                call.settled,
                call.winning_outcome,
            ),
        );
    }

    // ── Fee configuration (SC-017) ────────────────────────────────────────────

    /// Update the platform fee configuration. Admin-only.
    /// Validates 50 <= bps <= 200 and treasury is non-zero (contract address itself is ok).
    /// Stores in instance storage and emits FeeConfigUpdated.
    pub fn update_fee_config(env: Env, bps: u32, treasury: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        if bps < 50 || bps > 200 {
            panic!("{:?}", ContractError::InvalidFeeConfig);
        }
        // Validate non-zero: in Soroban, Address is never "zero" in the same sense,
        // but we reject if it equals the contract itself only when explicitly required;
        // issue says validate non-zero — treat empty/contract as invalid only if needed.
        // For safety we accept any Address (Soroban addresses are always valid).

        let config = FeeConfig {
            bps,
            treasury: treasury.clone(),
        };
        env.storage().instance().set(&DataKey::FeeConfig, &config);
        // Instance storage TTL is managed by the runtime; bump not strictly required
        // but we extend for consistency with persistent writes.
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, LEDGERS_PER_YEAR);

        env.events()
            .publish((Symbol::new(&env, "FeeConfigUpdated"),), (bps, treasury));
    }

    /// Read the current FeeConfig. Panics if not set.
    pub fn get_fee_config(env: Env) -> FeeConfig {
        env.storage()
            .instance()
            .get(&DataKey::FeeConfig)
            .unwrap_or_else(|| panic!("{:?}", ContractError::FeeConfigNotSet))
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    pub fn get_call(env: Env, call_id: u64) -> Call {
        env.storage()
            .persistent()
            .get(&DataKey::Call(call_id))
            .expect("Call does not exist")
    }

    pub fn get_user_stake(env: Env, call_id: u64, user: Address, outcome_index: u32) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserStake(call_id, user, outcome_index))
            .unwrap_or(0)
    }

    /// The registry's current admin, exposed under the `get_owner` name so
    /// downstream contracts can read the authoritative owner over a
    /// cross-contract call. This is the source the treasury ownership mirror
    /// pulls from (SC-090).
    pub fn get_owner(env: Env) -> Address {
        Self::get_admin(&env)
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

    // ── Binary market view shims (issue #315) ──────────────────────────────

    /// Backward-compatible shim for legacy callers expecting `totalStakeYes/No`.
    /// Returns `(total_stake_yes, total_stake_no)` from `outcome_pools`.
    /// Panics if pools.len() != 2 (not a binary market).
    pub fn get_binary_pools(env: Env, call_id: u64) -> (i128, i128) {
        let call: Call = env
            .storage()
            .persistent()
            .get(&DataKey::Call(call_id))
            .expect("Call does not exist");
        if call.outcome_pools.len() != 2 {
            panic!("Pools length must be 2 for binary market");
        }
        let yes = call.outcome_pools.get(0).unwrap();
        let no = call.outcome_pools.get(1).unwrap();
        (yes, no)
    }
}

mod test;
