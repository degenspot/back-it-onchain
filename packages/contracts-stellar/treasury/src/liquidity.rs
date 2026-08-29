use crate::treasury::get_treasury;
use crate::types::{Position, PositionSide};
use soroban_sdk::{symbol_short, Address, Env, Map, Symbol, Vec};

const MIN_LIQUIDITY: i128 = 10; // configurable baseline

const LIQUIDITY_PROVIDERS: Symbol = symbol_short!("PROVIDERS");
const TOTAL_LIQUIDITY: Symbol = symbol_short!("TOT_LIQ");
const TOTAL_SHARES: Symbol = symbol_short!("TOT_SHARE");

pub fn auto_provide_liquidity(env: &Env, call_id: u64, user_amount: i128) -> Position {
    let treasury = get_treasury(env);

    let short_amount = if user_amount < MIN_LIQUIDITY {
        MIN_LIQUIDITY
    } else {
        user_amount / 10
    };

    Position {
        user: treasury,
        amount: short_amount,
        side: PositionSide::Short,
        call_id,
    }
}

pub fn get_total_liquidity(env: &Env) -> u128 {
    env.storage()
        .persistent()
        .get(&TOTAL_LIQUIDITY)
        .unwrap_or(0)
}

pub fn get_total_shares(env: &Env) -> u128 {
    env.storage().persistent().get(&TOTAL_SHARES).unwrap_or(0)
}

pub fn get_user_shares(env: &Env, user: Address) -> u128 {
    let map: Map<Address, u128> = env
        .storage()
        .persistent()
        .get(&LIQUIDITY_PROVIDERS)
        .unwrap_or_else(|| Map::new(env));
    map.get(user).unwrap_or(0)
}

pub fn get_liquidity_providers(env: &Env, start: u32, mut limit: u32) -> Vec<Address> {
    if limit > 100 {
        limit = 100;
    }

    let map: Map<Address, u128> = env
        .storage()
        .persistent()
        .get(&LIQUIDITY_PROVIDERS)
        .unwrap_or_else(|| Map::new(env));

    let mut result = Vec::new(env);
    for (index, (addr, _)) in map.iter().enumerate() {
        if (index as u32) >= start {
            result.push_back(addr);
            if result.len() == limit {
                break;
            }
        }
    }

    result
}

pub fn get_share_price(env: &Env) -> u128 {
    let total_liquidity = get_total_liquidity(env);
    let total_shares = get_total_shares(env);

    if total_shares == 0 {
        return 0;
    }

    total_liquidity.checked_div(total_shares).unwrap_or(0)
}

// Internal functions for test purposes or state changes
pub fn add_liquidity(env: &Env, provider: Address, amount: u128, shares: u128) {
    let mut total_liq = get_total_liquidity(env);
    let mut total_shares = get_total_shares(env);

    total_liq += amount;
    total_shares += shares;

    env.storage().persistent().set(&TOTAL_LIQUIDITY, &total_liq);
    env.storage().persistent().set(&TOTAL_SHARES, &total_shares);

    // Bump TTL
    env.storage()
        .persistent()
        .extend_ttl(&TOTAL_LIQUIDITY, 3600, 3600);
    env.storage()
        .persistent()
        .extend_ttl(&TOTAL_SHARES, 3600, 3600);

    let mut map: Map<Address, u128> = env
        .storage()
        .persistent()
        .get(&LIQUIDITY_PROVIDERS)
        .unwrap_or_else(|| Map::new(env));

    let current_shares = map.get(provider.clone()).unwrap_or(0);
    map.set(provider.clone(), current_shares + shares);

    env.storage().persistent().set(&LIQUIDITY_PROVIDERS, &map);
    env.storage()
        .persistent()
        .extend_ttl(&LIQUIDITY_PROVIDERS, 3600, 3600);

    // Redundant event totals
    env.events().publish(
        (Symbol::new(env, "LiquidityAdded"), provider),
        (amount, shares, total_liq, total_shares),
    );
}

pub fn double_liquidity(env: &Env) {
    let mut total_liq = get_total_liquidity(env);
    total_liq *= 2;
    env.storage().persistent().set(&TOTAL_LIQUIDITY, &total_liq);
    env.storage()
        .persistent()
        .extend_ttl(&TOTAL_LIQUIDITY, 3600, 3600);
    env.events()
        .publish((Symbol::new(env, "LiquidityDoubled"),), total_liq);
}
