use crate::storage::DataKey;
use soroban_sdk::{Address, Env};

const TRANSFER_DELAY: u64 = 60 * 60 * 24; // 24h

pub fn transfer_ownership(e: &Env, new_owner: Address) {
    let now = e.ledger().timestamp();

    e.storage()
        .instance()
        .set(&DataKey::PendingOwner, &new_owner);
    e.storage()
        .instance()
        .set(&DataKey::OwnershipTransferTime, &now);
}

pub fn accept_ownership(e: &Env) {
    let now = e.ledger().timestamp();

    let ts: u64 = e
        .storage()
        .instance()
        .get(&DataKey::OwnershipTransferTime)
        .unwrap();
    let new_owner: Address = e.storage().instance().get(&DataKey::PendingOwner).unwrap();

    if now <= ts + TRANSFER_DELAY {
        panic!("Too early");
    }

    e.storage().instance().set(&DataKey::Owner, &new_owner);
}
