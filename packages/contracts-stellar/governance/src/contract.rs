use soroban_sdk::{Address, Env};

use crate::ownership::{
    accept_ownership as accept_ownership_internal,
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
pub fn transfer_ownership(e: &Env, caller: &Address, new_owner: &Address) {
    require_owner(e, caller);
    transfer_ownership_internal(e, new_owner.clone());
}

pub fn accept_ownership(e: &Env) {
    accept_ownership_internal(e);
}

// ---------------------------
// SOULBOUND TOKEN
// ---------------------------
pub fn mint_pity_token(e: &Env, caller: &Address, user: &Address) {
    require_councilor(e, caller);
    mint_soul(e, user.clone());
}
