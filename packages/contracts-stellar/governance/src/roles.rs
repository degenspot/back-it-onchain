use crate::errors::ContractError;
use crate::storage::DataKey;
use soroban_sdk::{panic_with_error, Address, Env};

pub fn require_owner(e: &Env, addr: &Address) {
    let owner: Address = e.storage().instance().get(&DataKey::Owner).unwrap();

    if &owner != addr {
        panic_with_error!(e, ContractError::Unauthorized);
    }
}

pub fn require_councilor(e: &Env, addr: &Address) {
    let councilor: Address = e.storage().instance().get(&DataKey::Councilor).unwrap();

    if &councilor != addr {
        panic_with_error!(e, ContractError::Unauthorized);
    }
}
