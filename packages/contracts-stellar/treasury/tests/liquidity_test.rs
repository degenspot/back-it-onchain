#![cfg(test)]
use soroban_sdk::{testutils::Address as _, Address, Env};
use treasury::liquidity::{add_liquidity, double_liquidity};
use treasury::TreasuryContract;
use treasury::TreasuryContractClient;

#[test]
fn test_pagination_and_price() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TreasuryContract);
    let client = TreasuryContractClient::new(&env, &contract_id);

    // 3 providers
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let p3 = Address::generate(&env);

    env.as_contract(&contract_id, || add_liquidity(&env, p1.clone(), 100, 100));
    env.as_contract(&contract_id, || add_liquidity(&env, p2.clone(), 200, 200));
    env.as_contract(&contract_id, || add_liquidity(&env, p3.clone(), 300, 300));

    // test pagination 2+1
    let page1 = client.get_liquidity_providers(&0, &2);
    assert_eq!(page1.len(), 2);

    let page2 = client.get_liquidity_providers(&2, &2);
    assert_eq!(page2.len(), 1);

    // total share price should be 1.0 (represented as 1 in integer division? Wait, if it's 1.0, and u128, then 600 / 600 = 1).
    let initial_price = client.get_share_price();
    assert_eq!(initial_price, 1u128);

    // double liquidity -> price 2.0
    env.as_contract(&contract_id, || double_liquidity(&env));

    let double_price = client.get_share_price();
    assert_eq!(double_price, 2u128);
}

#[test]
fn test_zero_shares_price() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TreasuryContract);
    let client = TreasuryContractClient::new(&env, &contract_id);

    // 0 shares initially
    assert_eq!(client.get_share_price(), 0u128);
}
