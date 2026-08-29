#![cfg(test)]

use soroban_sdk::{testutils::Address as _, token, Address, Env};
use treasury::liquidity::{add_liquidity_internal, double_liquidity};
use treasury::Treasury;
use treasury::TreasuryClient;

fn setup_treasury(env: &Env) -> (TreasuryClient<'_>, Address, Address, Address) {
    env.mock_all_auths();

    let owner = Address::generate(env);
    let owner_source = Address::generate(env);
    let payout = Address::generate(env);

    let treasury_id = env.register_contract(None, Treasury);
    let client = TreasuryClient::new(env, &treasury_id);
    client.initialize(&owner, &owner_source);
    client.set_treasury(&owner, &payout);

    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let stake_token = token_contract.address();
    client.set_liquidity_token(&owner, &stake_token);

    let registry_id = env.register_contract(None, call_registry::CallRegistry);
    let registry_client = call_registry::CallRegistryClient::new(env, &registry_id);
    registry_client.initialize(&owner);
    registry_client.set_treasury_contract(&treasury_id);
    client.set_call_registry(&owner, &registry_id);

    (client, owner, payout, stake_token)
}

#[test]
fn test_pagination_and_price() {
    let env = Env::default();
    let (client, _, _, _) = setup_treasury(&env);
    let contract_id = client.address.clone();

    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let p3 = Address::generate(&env);

    env.as_contract(&contract_id, || {
        add_liquidity_internal(&env, p1.clone(), 100, 100)
    });
    env.as_contract(&contract_id, || {
        add_liquidity_internal(&env, p2.clone(), 200, 200)
    });
    env.as_contract(&contract_id, || {
        add_liquidity_internal(&env, p3.clone(), 300, 300)
    });

    let page1 = client.get_liquidity_providers(&0, &2);
    assert_eq!(page1.len(), 2);

    let page2 = client.get_liquidity_providers(&2, &2);
    assert_eq!(page2.len(), 1);

    assert_eq!(client.get_share_price(), 1u128);

    env.as_contract(&contract_id, || double_liquidity(&env));
    assert_eq!(client.get_share_price(), 2u128);
}

#[test]
fn test_zero_shares_price() {
    let env = Env::default();
    let (client, _, _, _) = setup_treasury(&env);
    assert_eq!(client.get_share_price(), 0u128);
}

#[test]
fn test_add_liquidity_first_one_to_one_then_fifty_fifty() {
    let env = Env::default();
    let (client, owner, _, stake_token) = setup_treasury(&env);

    let provider_a = Address::generate(&env);
    let provider_b = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &stake_token);
    token_admin.mint(&provider_a, &2_000);
    token_admin.mint(&provider_b, &2_000);

    client.add_liquidity(&provider_a, &1_000);
    assert_eq!(client.get_user_shares(&provider_a), 1_000);
    assert_eq!(client.get_total_liquidity(), 1_000);
    assert_eq!(client.get_total_shares(), 1_000);

    client.add_liquidity(&provider_b, &1_000);
    assert_eq!(client.get_user_shares(&provider_b), 1_000);
    assert_eq!(client.get_total_shares(), 2_000);
    assert_eq!(client.get_user_shares(&provider_a), 1_000);

    let token_client = token::Client::new(&env, &stake_token);
    assert_eq!(token_client.balance(&client.address), 2_000);
    assert_eq!(token_client.balance(&provider_a), 1_000);
    assert_eq!(token_client.balance(&provider_b), 1_000);

    let _ = owner;
}

#[test]
fn test_remove_liquidity_fifty_percent_and_dust() {
    let env = Env::default();
    let (client, _, _, stake_token) = setup_treasury(&env);

    let provider = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &stake_token);
    token_admin.mint(&provider, &1_003);

    client.add_liquidity(&provider, &1_003);
    assert_eq!(client.get_total_liquidity(), 1_003);
    assert_eq!(client.get_total_shares(), 1_003);
    assert_eq!(client.get_user_shares(&provider), 1_003);

    client.remove_liquidity(&provider, &501);
    assert_eq!(client.get_user_shares(&provider), 502);
    assert_eq!(client.get_total_shares(), 502);
    assert_eq!(client.get_total_liquidity(), 502);

    let token_client = token::Client::new(&env, &stake_token);
    assert_eq!(token_client.balance(&provider), 501);
    assert_eq!(token_client.balance(&client.address), 502);
}

#[test]
#[should_panic(expected = "Error(Contract, #47)")]
fn test_remove_over_shares_reverts() {
    let env = Env::default();
    let (client, _, _, stake_token) = setup_treasury(&env);

    let provider = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &stake_token);
    token_admin.mint(&provider, &100);

    client.add_liquidity(&provider, &100);
    client.remove_liquidity(&provider, &101);
}

#[test]
fn test_split_fees_seventy_thirty_and_remainder() {
    let env = Env::default();
    let (client, owner, payout, stake_token) = setup_treasury(&env);
    let registry_id = client.get_call_registry();
    let registry = call_registry::CallRegistryClient::new(&env, &registry_id);

    let token_admin = token::StellarAssetClient::new(&env, &stake_token);
    token_admin.mint(&client.address, &10_001);

    client.split_fees(&owner, &10_000);
    assert_eq!(registry.get_platform_fees(), 3_000);

    let token_client = token::Client::new(&env, &stake_token);
    assert_eq!(token_client.balance(&payout), 7_000);
    assert_eq!(token_client.balance(&registry_id), 3_000);
    assert_eq!(token_client.balance(&client.address), 1);

    client.split_fees(&owner, &1);
    assert_eq!(registry.get_platform_fees(), 3_001);
    assert_eq!(token_client.balance(&payout), 7_000);
    assert_eq!(token_client.balance(&registry_id), 3_001);
    assert_eq!(token_client.balance(&client.address), 0);
}
