use soroban_sdk::{symbol_short, Address, Env};
use crate::types::{CallOutcome, DisputeResolution};

pub fn emit_initialized(env: &Env, admin: &Address, window: u64, min_bond: i128) {
    env.events().publish(
        (symbol_short!("init"),),
        (admin.clone(), window, min_bond),
    );
}

pub fn emit_outcome_submitted(
    env: &Env,
    call_id: u64,
    submitter: &Address,
    outcome: &CallOutcome,
    window_expires_at: u64,
) {
    env.events().publish(
        (symbol_short!("proposed"), call_id),
        (submitter.clone(), outcome.result_code, window_expires_at),
    );
}

pub fn emit_dispute_raised(
    env: &Env,
    call_id: u64,
    staker: &Address,
    bond_amount: i128,
    disputed_at: u64,
) {
    env.events().publish(
        (symbol_short!("disputed"), call_id),
        (staker.clone(), bond_amount, disputed_at),
    );
}

pub fn emit_dispute_resolved(
    env: &Env,
    call_id: u64,
    resolution: &DisputeResolution,
    final_outcome: &CallOutcome,
) {
    let resolution_code: u32 = match resolution {
        DisputeResolution::UpholdDispute => 1,
        DisputeResolution::RejectDispute => 0,
    };
    env.events().publish(
        (symbol_short!("resolved"), call_id),
        (resolution_code, final_outcome.result_code),
    );
}

pub fn emit_outcome_finalized(env: &Env, call_id: u64, outcome: &CallOutcome) {
    env.events().publish(
        (symbol_short!("finalized"), call_id),
        (outcome.result_code,),
    );
}

pub fn emit_admin_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (symbol_short!("newadmin"),),
        (old_admin.clone(), new_admin.clone()),
    );
}
