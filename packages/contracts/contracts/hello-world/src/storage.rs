use soroban_sdk::{contracttype, Address, Env};
use crate::errors::ContractError;
use crate::types::CallRecord;

// ── Storage key schema ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    ProposalWindow,
    MinBond,
    Token,
    Initialized,
    Call(u64),
}

// ── Initialization flag ───────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn mark_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
    mark_initialized(env);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not set")
}

// ── Proposal window ───────────────────────────────────────────────────────────

pub fn set_proposal_window(env: &Env, seconds: u64) {
    env.storage()
        .instance()
        .set(&DataKey::ProposalWindow, &seconds);
}

pub fn get_proposal_window(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ProposalWindow)
        .unwrap_or(86_400u64) // default: 24 hours
}

// ── Minimum bond ──────────────────────────────────────────────────────────────

pub fn set_min_bond(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::MinBond, &amount);
}

pub fn get_min_bond(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MinBond)
        .unwrap_or(0i128)
}

// ── Bond token ────────────────────────────────────────────────────────────────

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Result<Address, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(ContractError::TokenNotSet)
}

// ── Call records ──────────────────────────────────────────────────────────────

pub fn save_call(env: &Env, call_id: u64, record: &CallRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Call(call_id), record);
}

pub fn load_call(env: &Env, call_id: u64) -> Result<CallRecord, ContractError> {
    env.storage()
        .persistent()
        .get(&DataKey::Call(call_id))
        .ok_or(ContractError::CallNotFound)
}

pub fn assert_call_not_exists(env: &Env, call_id: u64) -> Result<(), ContractError> {
    if env
        .storage()
        .persistent()
        .has(&DataKey::Call(call_id))
    {
        return Err(ContractError::CallAlreadyExists);
    }
    Ok(())
}
