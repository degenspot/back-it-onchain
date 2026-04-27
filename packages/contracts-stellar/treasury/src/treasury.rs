use soroban_sdk::{Env, Address};

const TREASURY_KEY: &str = "TREASURY";

pub fn set_treasury(env: &Env, addr: Address) {
    env.storage().instance().set(&TREASURY_KEY, &addr);
}

pub fn get_treasury(env: &Env) -> Address {
    env.storage().instance().get(&TREASURY_KEY).unwrap()
}