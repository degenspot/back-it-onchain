//! Treasury contract.
//!
//! Two responsibilities today:
//!
//! * **Ownership mirror (SC-090)** — a two-step `propose_owner` / `accept_owner`
//!   transfer that reuses `governance::ownership`, plus `sync_owner` to pull the
//!   authoritative owner from the registry so the two never drift apart.
//! * **Fee helpers (SC-016 / SC-017 / SC-088)** — pure arithmetic for fee
//!   configuration, dividend dust and fee accrual. The authoritative `FeeConfig`
//!   and `PlatformFees` state lives in `call_registry`; these helpers exist so
//!   the maths can be reviewed and unit-tested independently of the host.

use governance::errors::ContractError;
use governance::ownership;
use soroban_sdk::{contract, contractimpl, contracttype, panic_with_error, Address, Env, Symbol};

// ── TTL constants (issue #169) ───────────────────────────────────────────────
/// Approximate ledger count for 1 year (≈ 6 s per ledger, 365.25 days).
const LEDGERS_PER_YEAR: u32 = 5_259_600;
/// Re-extend TTL if it falls below 30 days of remaining ledgers.
const TTL_THRESHOLD: u32 = 432_000; // ~30 days

fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, LEDGERS_PER_YEAR);
}

// ── Owner-source interface (SC-090) ──────────────────────────────────────────
//
// Any contract exposing `get_owner() -> Address` can be the authoritative owner
// for this treasury; in practice that is `call_registry`.
mod owner_iface {
    use soroban_sdk::{contractclient, Address, Env};

    #[allow(dead_code)]
    #[contractclient(name = "OwnerSourceClient")]
    pub trait OwnerSource {
        fn get_owner(env: Env) -> Address;
    }
}

// ── Data types ───────────────────────────────────────────────────────────────

/// Treasury-owned instance keys.
///
/// `Owner`, `PendingOwner` and `OwnershipTransferTime` are deliberately absent:
/// they belong to `governance::storage::DataKey` and are written by
/// `governance::ownership` against *this* contract's instance storage. Adding
/// same-named variants here would collide with them.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Contract whose owner this treasury mirrors (SC-090).
    OwnerSource,
    /// Legacy treasury payout address (see `set_treasury`).
    TreasuryAddress,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct Treasury;

#[contractimpl]
impl Treasury {
    /// Initialize the treasury with an `owner` and the contract whose ownership
    /// it mirrors. Panics with `AlreadyInitialized` on a second call.
    pub fn initialize(env: Env, owner: Address, owner_source: Address) {
        owner.require_auth();

        ownership::initialize_owner(&env, &owner);
        env.storage()
            .instance()
            .set(&DataKey::OwnerSource, &owner_source);
        bump_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "TreasuryInitialized"),),
            (owner, owner_source),
        );
    }

    // ── Two-step ownership (SC-090) ──────────────────────────────────────────

    /// Step 1 — the current owner proposes `new_owner`.
    ///
    /// The owner does **not** change here; `new_owner` must call `accept_owner`
    /// after the transfer delay. Re-proposing overwrites the pending target and
    /// restarts the delay.
    ///
    /// Reverts with `Unauthorized` if `caller` is not the owner, `InvalidOwner`
    /// if `new_owner` is already the owner.
    pub fn propose_owner(env: Env, caller: Address, new_owner: Address) {
        caller.require_auth();
        governance::transfer_ownership(&env, &caller, &new_owner);
    }

    /// Step 2 — the proposed owner accepts and becomes the owner.
    ///
    /// Reverts with `Unauthorized` for any caller that is not the pending owner
    /// (this is what makes the transfer two-step rather than a unilateral push),
    /// `NoPendingOwner` when nothing is in flight, and
    /// `OwnershipTransferTooEarly` before the delay has elapsed.
    pub fn accept_owner(env: Env, new_owner: Address) {
        new_owner.require_auth();
        governance::accept_ownership(&env, &new_owner);
    }

    /// Withdraw an in-flight proposal without changing the owner. Owner-only.
    pub fn cancel_owner_proposal(env: Env, caller: Address) {
        caller.require_auth();
        governance::cancel_ownership_transfer(&env, &caller);
    }

    /// Mirror the owner from the configured source contract.
    ///
    /// Permissionless by design: it can only ever install the owner the source
    /// already has, so there is nothing to gain by triggering it, and anyone
    /// noticing drift can repair it without waiting on the owner.
    ///
    /// Any in-flight local proposal is discarded — a proposal made under the
    /// *previous* owner must not survive an owner change, or that stale address
    /// could later accept and displace the mirrored owner.
    ///
    /// Returns the owner in force after the sync. Emits `OwnerSynced` only when
    /// the owner actually moved.
    pub fn sync_owner(env: Env) -> Address {
        let source = Self::get_owner_source(env.clone());
        let remote_owner = owner_iface::OwnerSourceClient::new(&env, &source).get_owner();
        let local_owner = ownership::get_owner(&env);

        if local_owner == remote_owner {
            return local_owner;
        }

        let cleared_pending = ownership::mirror_owner(&env, &remote_owner);
        bump_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "OwnerSynced"), source),
            (
                local_owner,
                remote_owner.clone(), // new owner, also the return value
                cleared_pending,      // a stale proposal was discarded
            ),
        );

        remote_owner
    }

    /// Repoint the mirror at a different source contract. Owner-only.
    ///
    /// This is the trust root of `sync_owner` — whoever controls the source
    /// contract's owner controls this treasury's owner — so it is gated on the
    /// current owner and announced.
    pub fn set_owner_source(env: Env, caller: Address, owner_source: Address) {
        caller.require_auth();
        Self::require_owner(&env, &caller);

        let previous: Option<Address> = env.storage().instance().get(&DataKey::OwnerSource);
        env.storage()
            .instance()
            .set(&DataKey::OwnerSource, &owner_source);
        bump_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "OwnerSourceUpdated"),),
            (previous, owner_source),
        );
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    /// Current treasury owner. Panics with `OwnerNotSet` if uninitialized.
    pub fn get_owner(env: Env) -> Address {
        ownership::get_owner(&env)
    }

    /// Address with an in-flight ownership proposal, if any.
    pub fn get_pending_owner(env: Env) -> Option<Address> {
        ownership::get_pending_owner(&env)
    }

    /// Ledger timestamp from which the pending proposal may be accepted.
    pub fn get_ownership_ready_at(env: Env) -> Option<u64> {
        ownership::get_ownership_ready_at(&env)
    }

    /// Contract this treasury mirrors its owner from.
    /// Panics with `OwnerSourceNotSet` if never configured.
    pub fn get_owner_source(env: Env) -> Address {
        let source: Option<Address> = env.storage().instance().get(&DataKey::OwnerSource);
        match source {
            Some(s) => s,
            None => panic_with_error!(&env, ContractError::OwnerSourceNotSet),
        }
    }

    // ── Legacy treasury address helper ───────────────────────────────────────

    /// Persist the treasury payout address. Owner-only.
    pub fn set_treasury(env: Env, caller: Address, addr: Address) {
        caller.require_auth();
        Self::require_owner(&env, &caller);

        env.storage()
            .instance()
            .set(&DataKey::TreasuryAddress, &addr);
        bump_instance_ttl(&env);

        env.events()
            .publish((Symbol::new(&env, "TreasuryAddressSet"),), addr);
    }

    /// Retrieve the address set via `set_treasury`.
    /// Panics with `FeeConfigNotSet` if never configured.
    pub fn get_treasury(env: Env) -> Address {
        let addr: Option<Address> = env.storage().instance().get(&DataKey::TreasuryAddress);
        match addr {
            Some(a) => a,
            None => panic_with_error!(&env, ContractError::FeeConfigNotSet),
        }
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    fn require_owner(env: &Env, caller: &Address) {
        if &ownership::get_owner(env) != caller {
            panic_with_error!(env, ContractError::Unauthorized);
        }
    }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────
//
// Host-independent arithmetic mirroring the fee logic that `call_registry`
// applies on-chain.

/// Validate that a fee bps value is within the protocol range [50, 200].
pub fn is_valid_fee_bps(bps: u32) -> bool {
    (50..=200).contains(&bps)
}

/// Compute a proportional share: `total * weight / total_weight` with checked
/// arithmetic. Returns 0 on any overflow or zero denominator.
pub fn proportional_share(total: i128, weight: i128, total_weight: i128) -> i128 {
    if total_weight <= 0 || weight < 0 || total < 0 {
        return 0;
    }
    total
        .checked_mul(weight)
        .and_then(|p| p.checked_div(total_weight))
        .unwrap_or(0)
}

// ── Fee accrual helpers (SC-088) ─────────────────────────────────────────────
//
// The authoritative `PlatformFees` balance lives in `call_registry` persistent
// storage and is mutated through the `accrue_fee` hook. These helpers hold the
// pure arithmetic so it can be reviewed and unit-tested independently of the
// Soroban host.

/// Fee taken from `amount` at `bps` basis points, using checked arithmetic.
///
/// Returns `None` on overflow. Integer division truncates, so sub-`10_000 / bps`
/// amounts accrue nothing — the remainder stays with the staker, never the
/// platform.
pub fn fee_from_bps(amount: i128, bps: i128) -> Option<i128> {
    if amount <= 0 || bps <= 0 {
        return Some(0);
    }
    amount.checked_mul(bps)?.checked_div(10_000)
}

/// New `PlatformFees` total after accruing `fee_amount` on top of `current`.
///
/// Returns `None` on overflow (the caller is expected to surface
/// `ContractError::ArithmeticOverflow`) and on a negative `fee_amount`, which
/// would silently drain the accrued balance.
pub fn accrue_fee(current: i128, fee_amount: i128) -> Option<i128> {
    if fee_amount < 0 || current < 0 {
        return None;
    }
    current.checked_add(fee_amount)
}
