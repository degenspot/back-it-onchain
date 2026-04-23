use soroban_sdk::{symbol_short, Address, Env};

pub fn mint_soul(e: &Env, user: Address) {
    let key = (symbol_short!("SOUL"), user.clone());
    e.storage().persistent().set(&key, &true);
}

// Prevent transfer by design (no transfer function)
