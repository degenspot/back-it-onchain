use crate::treasury::{bump_persistent_ttl, get_liquidity_token_address};
use crate::types::{Position, PositionSide};
use governance::errors::ContractError;
use soroban_sdk::{panic_with_error, symbol_short, token, Address, Env, Map, Symbol, Vec};

const MIN_LIQUIDITY: i128 = 10;

const LIQUIDITY_PROVIDERS: Symbol = symbol_short!("PROVIDERS");
const TOTAL_LIQUIDITY: Symbol = symbol_short!("TOT_LIQ");
const TOTAL_SHARES: Symbol = symbol_short!("TOT_SHARE");

pub fn auto_provide_liquidity(env: &Env, call_id: u64, user_amount: i128) -> Position {
    let treasury = crate::treasury::treasury_payout_address(env);

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

/// Mint shares for `amount` deposited by `from` and pull tokens into the contract.
pub fn add_liquidity(env: &Env, from: Address, amount: i128) {
    from.require_auth();

    if amount <= 0 {
        panic_with_error!(env, ContractError::InvalidAmount);
    }

    let amount_u128 = u128::try_from(amount).unwrap_or_else(|_| {
        panic_with_error!(env, ContractError::ArithmeticOverflow);
    });

    let token = get_liquidity_token_address(env);
    let token_client = token::Client::new(env, &token);
    token_client.transfer(&from, &env.current_contract_address(), &amount);

    let total_liq = get_total_liquidity(env);
    let total_shares = get_total_shares(env);

    let shares = if total_liq == 0 {
        amount_u128
    } else {
        amount_u128
            .checked_mul(total_shares)
            .and_then(|product| product.checked_div(total_liq))
            .unwrap_or_else(|| panic_with_error!(env, ContractError::ArithmeticOverflow))
    };

    apply_add_liquidity(env, from, amount_u128, shares);
}

/// Burn `shares` from `to` and transfer pro-rata liquidity back to `to`.
pub fn remove_liquidity(env: &Env, to: Address, shares: u128) {
    to.require_auth();

    if shares == 0 {
        panic_with_error!(env, ContractError::InvalidAmount);
    }

    let total_shares = get_total_shares(env);
    if total_shares == 0 {
        panic_with_error!(env, ContractError::NoLiquidityShares);
    }

    let user_shares = get_user_shares(env, to.clone());
    if shares > user_shares {
        panic_with_error!(env, ContractError::InsufficientShares);
    }

    let total_liq = get_total_liquidity(env);
    let amount = shares
        .checked_mul(total_liq)
        .and_then(|product| product.checked_div(total_shares))
        .unwrap_or_else(|| panic_with_error!(env, ContractError::ArithmeticOverflow));

    let new_total_liq = total_liq
        .checked_sub(amount)
        .unwrap_or_else(|| panic_with_error!(env, ContractError::ArithmeticOverflow));
    let new_total_shares = total_shares
        .checked_sub(shares)
        .unwrap_or_else(|| panic_with_error!(env, ContractError::ArithmeticOverflow));

    env.storage()
        .persistent()
        .set(&TOTAL_LIQUIDITY, &new_total_liq);
    bump_persistent_ttl(env, &TOTAL_LIQUIDITY);
    env.storage()
        .persistent()
        .set(&TOTAL_SHARES, &new_total_shares);
    bump_persistent_ttl(env, &TOTAL_SHARES);

    let mut map: Map<Address, u128> = env
        .storage()
        .persistent()
        .get(&LIQUIDITY_PROVIDERS)
        .unwrap_or_else(|| Map::new(env));

    let remaining = user_shares - shares;
    if remaining == 0 {
        map.remove(to.clone());
    } else {
        map.set(to.clone(), remaining);
    }

    env.storage().persistent().set(&LIQUIDITY_PROVIDERS, &map);
    bump_persistent_ttl(env, &LIQUIDITY_PROVIDERS);

    if amount > 0 {
        let token = get_liquidity_token_address(env);
        let token_client = token::Client::new(env, &token);
        let amount_i128 = i128::try_from(amount).unwrap_or_else(|_| {
            panic_with_error!(env, ContractError::ArithmeticOverflow);
        });
        token_client.transfer(&env.current_contract_address(), &to, &amount_i128);
    }

    env.events().publish(
        (Symbol::new(env, "LiquidityRemoved"), to.clone()),
        (shares, amount, new_total_liq, new_total_shares),
    );
}

fn apply_add_liquidity(env: &Env, provider: Address, amount: u128, shares: u128) {
    let total_liq = get_total_liquidity(env)
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(env, ContractError::ArithmeticOverflow));
    let total_shares = get_total_shares(env)
        .checked_add(shares)
        .unwrap_or_else(|| panic_with_error!(env, ContractError::ArithmeticOverflow));

    env.storage().persistent().set(&TOTAL_LIQUIDITY, &total_liq);
    bump_persistent_ttl(env, &TOTAL_LIQUIDITY);
    env.storage().persistent().set(&TOTAL_SHARES, &total_shares);
    bump_persistent_ttl(env, &TOTAL_SHARES);

    let mut map: Map<Address, u128> = env
        .storage()
        .persistent()
        .get(&LIQUIDITY_PROVIDERS)
        .unwrap_or_else(|| Map::new(env));

    let current_shares = map.get(provider.clone()).unwrap_or(0);
    map.set(provider.clone(), current_shares + shares);

    env.storage().persistent().set(&LIQUIDITY_PROVIDERS, &map);
    bump_persistent_ttl(env, &LIQUIDITY_PROVIDERS);

    env.events().publish(
        (Symbol::new(env, "LiquidityAdded"), provider),
        (amount, shares, total_liq, total_shares),
    );
}

/// Test helper: double tracked liquidity without changing share supply.
pub fn double_liquidity(env: &Env) {
    let mut total_liq = get_total_liquidity(env);
    total_liq = total_liq
        .checked_mul(2)
        .unwrap_or_else(|| panic_with_error!(env, ContractError::ArithmeticOverflow));
    env.storage().persistent().set(&TOTAL_LIQUIDITY, &total_liq);
    bump_persistent_ttl(env, &TOTAL_LIQUIDITY);
    env.events()
        .publish((Symbol::new(env, "LiquidityDoubled"),), total_liq);
}

/// Apply liquidity state directly (used by view/pagination tests).
pub fn add_liquidity_internal(env: &Env, provider: Address, amount: u128, shares: u128) {
    apply_add_liquidity(env, provider, amount, shares);
}
