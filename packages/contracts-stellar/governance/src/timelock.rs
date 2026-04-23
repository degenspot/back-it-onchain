use crate::errors::ContractError;
use crate::storage::DataKey;
use soroban_sdk::{panic_with_error, Env};

const DELAY: u64 = 60 * 60 * 48;

pub fn queue_fee_change(e: &Env, new_fee: u32) {
    let now = e.ledger().timestamp();

    e.storage().instance().set(&DataKey::PendingFee, &new_fee);
    e.storage()
        .instance()
        .set(&DataKey::FeeApplyTime, &(now + DELAY));
}

pub fn apply_fee_change(e: &Env) {
    let now = e.ledger().timestamp();

    let ready_at: u64 = e.storage().instance().get(&DataKey::FeeApplyTime).unwrap();

    if now < ready_at {
        panic_with_error!(e, ContractError::NotReady);
    }

    let queued_fee: u32 = e.storage().instance().get(&DataKey::PendingFee).unwrap();

    e.storage().instance().set(&DataKey::Fee, &queued_fee);
}
