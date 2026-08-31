//! Two-step ownership transfer (propose → accept) over instance storage.
//!
//! These helpers are deliberately storage-only: they operate on
//! `e.storage().instance()` of whichever contract is currently executing. A
//! contract that links this crate therefore gets its own independent
//! `Owner` / `PendingOwner` entries — that is what lets the treasury *mirror*
//! the pattern (SC-090) rather than reach into governance's storage.
//!
//! Caller authorization (`require_owner`, `require_auth`) is the wrapper's
//! job; see `crate::contract` and `treasury`.

use crate::errors::ContractError;
use crate::storage::DataKey;
use soroban_sdk::{panic_with_error, Address, Env, Symbol};

/// Minimum time that must elapse between proposing and accepting ownership.
/// The proposed owner may accept only once `now > proposed_at + TRANSFER_DELAY`.
pub const TRANSFER_DELAY: u64 = 60 * 60 * 24; // 24h

// ── TTL constants (issue #169) ───────────────────────────────────────────────
/// Approximate ledger count for 1 year (≈ 6 s per ledger, 365.25 days).
const LEDGERS_PER_YEAR: u32 = 5_259_600;
/// Re-extend TTL if it falls below 30 days of remaining ledgers.
const TTL_THRESHOLD: u32 = 432_000; // ~30 days

/// Extend the instance TTL to 1 year whenever ownership state is written.
fn bump_instance_ttl(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, LEDGERS_PER_YEAR);
}

/// Seed the owner at initialization time.
///
/// Panics with `AlreadyInitialized` if an owner is already recorded, so a
/// second `initialize` cannot silently reassign ownership.
pub fn initialize_owner(e: &Env, owner: &Address) {
    if e.storage().instance().has(&DataKey::Owner) {
        panic_with_error!(e, ContractError::AlreadyInitialized);
    }

    e.storage().instance().set(&DataKey::Owner, owner);
    bump_instance_ttl(e);

    e.events()
        .publish((Symbol::new(e, "OwnerInitialized"),), owner.clone());
}

/// Current owner. Panics with `OwnerNotSet` if the contract is uninitialized.
pub fn get_owner(e: &Env) -> Address {
    let owner: Option<Address> = e.storage().instance().get(&DataKey::Owner);
    match owner {
        Some(o) => o,
        None => panic_with_error!(e, ContractError::OwnerNotSet),
    }
}

/// The address with an in-flight ownership proposal, if any.
pub fn get_pending_owner(e: &Env) -> Option<Address> {
    e.storage().instance().get(&DataKey::PendingOwner)
}

/// The ledger timestamp at which the pending proposal becomes acceptable,
/// or `None` when no proposal is in flight.
pub fn get_ownership_ready_at(e: &Env) -> Option<u64> {
    let proposed_at: Option<u64> = e.storage().instance().get(&DataKey::OwnershipTransferTime);
    proposed_at.map(|t| t.saturating_add(TRANSFER_DELAY))
}

/// Step 1 — record a proposal to hand ownership to `new_owner`.
///
/// Overwriting an existing proposal is allowed (it restarts the delay) and is
/// how the owner retargets a transfer; `cancel_ownership_transfer` withdraws
/// one outright. Panics with `InvalidOwner` when `new_owner` is already the
/// owner, which would otherwise queue a no-op transfer.
pub fn transfer_ownership(e: &Env, new_owner: Address) {
    let current = get_owner(e);
    if current == new_owner {
        panic_with_error!(e, ContractError::InvalidOwner);
    }

    let now = e.ledger().timestamp();
    let ready_at = now.saturating_add(TRANSFER_DELAY);

    e.storage()
        .instance()
        .set(&DataKey::PendingOwner, &new_owner);
    e.storage()
        .instance()
        .set(&DataKey::OwnershipTransferTime, &now);
    bump_instance_ttl(e);

    e.events().publish(
        (Symbol::new(e, "OwnershipProposed"),),
        (current, new_owner, now, ready_at),
    );

    // Deliberately no owner change here — see `accept_ownership`.
}

/// Step 2 — the proposed owner accepts and becomes the owner.
///
/// Reverts unless `caller` is *exactly* the pending owner (`Unauthorized`) and
/// the transfer delay has elapsed (`OwnershipTransferTooEarly`). The proposal
/// is cleared on success so the same acceptance cannot be replayed.
pub fn accept_ownership(e: &Env, caller: &Address) {
    let pending: Address = match get_pending_owner(e) {
        Some(p) => p,
        None => panic_with_error!(e, ContractError::NoPendingOwner),
    };
    if &pending != caller {
        panic_with_error!(e, ContractError::Unauthorized);
    }

    let proposed_at: Option<u64> = e.storage().instance().get(&DataKey::OwnershipTransferTime);
    let proposed_at = match proposed_at {
        Some(t) => t,
        None => panic_with_error!(e, ContractError::NoPendingOwner),
    };
    if e.ledger().timestamp() <= proposed_at.saturating_add(TRANSFER_DELAY) {
        panic_with_error!(e, ContractError::OwnershipTransferTooEarly);
    }

    let previous = get_owner(e);
    e.storage().instance().set(&DataKey::Owner, &pending);
    e.storage().instance().remove(&DataKey::PendingOwner);
    e.storage()
        .instance()
        .remove(&DataKey::OwnershipTransferTime);
    bump_instance_ttl(e);

    // Topic carries the new owner so indexers can filter; data repeats it
    // alongside the previous owner for a self-contained state transition.
    e.events().publish(
        (Symbol::new(e, "OwnershipTransferred"), pending.clone()),
        (previous, pending),
    );
}

/// Withdraw an in-flight proposal without changing the owner.
///
/// Panics with `NoPendingOwner` when there is nothing to cancel, so a caller
/// cannot mistake a no-op for a successful cancellation.
pub fn cancel_ownership_transfer(e: &Env) {
    let pending: Address = match get_pending_owner(e) {
        Some(p) => p,
        None => panic_with_error!(e, ContractError::NoPendingOwner),
    };

    e.storage().instance().remove(&DataKey::PendingOwner);
    e.storage()
        .instance()
        .remove(&DataKey::OwnershipTransferTime);
    bump_instance_ttl(e);

    e.events().publish(
        (Symbol::new(e, "OwnershipProposalCancelled"),),
        (get_owner(e), pending),
    );
}

/// Install `new_owner` directly, bypassing the two-step.
///
/// This exists solely for *mirroring*: the authoritative ownership decision was
/// already made (and two-step-guarded) on another contract, and this one is
/// only reflecting the result. Callers must establish that authority
/// themselves — nothing here checks it. See `treasury::Treasury::sync_owner`.
///
/// Any in-flight local proposal is cleared and the fact is reported in the
/// return value: a proposal made under the *previous* owner must not survive an
/// owner change, or that stale address could later accept and displace the
/// mirrored owner.
///
/// Returns `true` if a pending proposal was discarded.
pub fn mirror_owner(e: &Env, new_owner: &Address) -> bool {
    let had_pending = get_pending_owner(e).is_some();

    e.storage().instance().set(&DataKey::Owner, new_owner);
    if had_pending {
        e.storage().instance().remove(&DataKey::PendingOwner);
        e.storage()
            .instance()
            .remove(&DataKey::OwnershipTransferTime);
    }
    bump_instance_ttl(e);

    had_pending
}
