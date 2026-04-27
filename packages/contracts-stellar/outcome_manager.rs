use soroban_sdk::{Env, Address, Symbol};
use crate::storage_keys::DataKey;

pub struct OutcomeManager;

impl OutcomeManager {

    pub fn set_outcome_pool(env: &Env, market_id: Symbol, amount: i128) {
        env.storage()
            .instance()
            .set(&DataKey::OutcomePool(market_id), &amount);
    }

    pub fn get_outcome_pool(env: &Env, market_id: Symbol) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::OutcomePool(market_id))
            .unwrap_or(0)
    }

    pub fn stake_on_outcome(
        env: &Env,
        market_id: Symbol,
        user: Address,
        amount: i128,
    ) {
        let key = DataKey::OutcomeStake(market_id.clone(), user.clone());

        let current: i128 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(current + amount));

        // Update pool
        let pool_key = DataKey::OutcomePool(market_id.clone());
        let pool: i128 = env.storage().instance().get(&pool_key).unwrap_or(0);
        env.storage().instance().set(&pool_key, &(pool + amount));
    }
}