use soroban_sdk::{contract, contractimpl, Address, Env};

use crate::ownership::*;
use crate::roles::*;
use crate::soulbound::*;
use crate::storage::DataKey;
use crate::timelock::*;

#[contract]
pub struct Governance;

#[contractimpl]
impl Governance {
    pub fn initialize(e: Env, owner: Address, councilor: Address) {
        e.storage().instance().set(&DataKey::Owner, &owner);
        e.storage().instance().set(&DataKey::Councilor, &councilor);
        e.storage().instance().set(&DataKey::Paused, &false);
    }

    // ---------------------------
    // 🕒 TIMELOCK FEE UPDATE
    // ---------------------------
    pub fn queue_update_fee(e: Env, caller: Address, new_fee: u32) {
        require_owner(&e, &caller);
        queue_fee_update(&e, new_fee);
    }

    pub fn execute_update_fee(e: Env) {
        execute_fee_update(&e);
    }

    // ---------------------------
    // 🛑 PAUSE SYSTEM
    // ---------------------------
    pub fn pause(e: Env, caller: Address) {
        require_councilor(&e, &caller);
        e.storage().instance().set(&DataKey::Paused, &true);
    }

    pub fn unpause(e: Env, caller: Address) {
        require_owner(&e, &caller);
        e.storage().instance().set(&DataKey::Paused, &false);
    }

    // ---------------------------
    // 🔐 OWNERSHIP (MULTISIG READY)
    // ---------------------------
    pub fn transfer_ownership(e: Env, caller: Address, new_owner: Address) {
        transfer_ownership(&e, new_owner);
        accept_ownership(&e);
    }

    pub fn accept_ownership(e: Env) {
        accept_transfer(&e);
    }

    // ---------------------------
    // 🪙 SOULBOUND TOKEN
    // ---------------------------
    pub fn mint_pity_token(e: Env, user: Address) {
        mint_soul(&e, user);
    }
}
