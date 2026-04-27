use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {

    pub fn stake(env: Env, user: Address, amount: i128) {
        let mut total = Self::get_total_pool(env.clone());
        total += amount;

        env.storage().instance().set(&"total_pool", &total);
    }

    pub fn get_total_pool(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&"total_pool")
            .unwrap_or(0)
    }
}