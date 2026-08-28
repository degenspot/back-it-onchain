use soroban_sdk::{Address, Env};

use crate::ownership::{
    accept_ownership as accept_ownership_internal,
    cancel_ownership_transfer as cancel_ownership_transfer_internal,
    transfer_ownership as transfer_ownership_internal,
};
use crate::roles::*;
use crate::soulbound::*;
use crate::storage::DataKey;
use crate::timelock::*;

/// Governance module functions - exported as regular functions for use by other contracts
pub fn initialize(e: &Env, owner: &Address, councilor: &Address) {
    e.storage().instance().set(&DataKey::Owner, owner);
    e.storage().instance().set(&DataKey::Councilor, councilor);
    e.storage().instance().set(&DataKey::Paused, &false);
}

// ---------------------------
// TIMELOCK FEE UPDATE
// ---------------------------
pub fn queue_update_fee(e: &Env, caller: &Address, new_fee: u32) {
    require_owner(e, caller);
    queue_fee_change(e, new_fee);
}

pub fn execute_update_fee(e: &Env) {
    apply_fee_change(e);
}

// ---------------------------
// PAUSE SYSTEM
// ---------------------------
pub fn pause(e: &Env, caller: &Address) {
    require_councilor(e, caller);
    e.storage().instance().set(&DataKey::Paused, &true);
}

pub fn unpause(e: &Env, caller: &Address) {
    require_owner(e, caller);
    e.storage().instance().set(&DataKey::Paused, &false);
}

// ---------------------------
// OWNERSHIP
// ---------------------------
/// Step 1 of the two-step transfer — owner-only. Records the proposal; the
/// owner is unchanged until `accept_ownership`.
pub fn transfer_ownership(e: &Env, caller: &Address, new_owner: &Address) {
    require_owner(e, caller);
    transfer_ownership_internal(e, new_owner.clone());
}

/// Step 2 — only the proposed owner may accept, and only after the transfer
/// delay. `caller` is checked against the stored `PendingOwner`, so a third
/// party cannot push the transfer through on the proposed owner's behalf.
pub fn accept_ownership(e: &Env, caller: &Address) {
    accept_ownership_internal(e, caller);
}

/// Withdraw an in-flight proposal — owner-only.
pub fn cancel_ownership_transfer(e: &Env, caller: &Address) {
    require_owner(e, caller);
    cancel_ownership_transfer_internal(e);
}

// ---------------------------
// SOULBOUND TOKEN
// ---------------------------
pub fn mint_pity_token(e: &Env, caller: &Address, user: &Address) {
    require_councilor(e, caller);
    mint_soul(e, user.clone());
}
