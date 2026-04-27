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

use soroban_sdk::{contract, contractimpl, Env, Address};
use crate::guard::ReentrancyGuard;

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {

    pub fn withdraw_payout(env: Env, user: Address, amount: i128) {
        // 🔐 ENTER GUARD
        ReentrancyGuard::enter(&env);

        // --- Critical Section START ---
        let mut balance = Self::get_balance(env.clone(), user.clone());

        if balance < amount {
            panic!("Insufficient balance");
        }

        balance -= amount;

        env.storage()
            .instance()
            .set(&(user.clone(), "balance"), &balance);

        // Simulate external interaction (future cross-contract call)
        Self::simulate_external_call(&env);
        // --- Critical Section END ---

        // 🔓 EXIT GUARD
        ReentrancyGuard::exit(&env);
    }

    pub fn get_balance(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&(user, "balance"))
            .unwrap_or(0)
    }

    fn simulate_external_call(env: &Env) {
        // Placeholder for future cross-contract call
        // This is where reentrancy *would* happen if not protected
        let _ = env;
    }
}