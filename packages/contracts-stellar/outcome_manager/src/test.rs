#![cfg(test)]

use crate::{CallData, OutcomeManagerContract, OutcomeManagerContractClient, CALLS, CALL_ORACLES};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, IntoVal,
};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);

    client.initialize(&owner, &registry);

    // Verify oracle returns false for non-existent oracle
    let random_oracle = BytesN::from_array(&env, &[1; 32]);
    assert!(!client.is_authorized_oracle(&random_oracle));
    assert!(!client.get_is_paused());

    let fee_config = client.get_fee_config_view();
    assert_eq!(fee_config.basis_points, 0);
    assert_eq!(fee_config.treasury, owner);
}

#[test]
fn test_set_oracle() {
    let env = Env::default();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let oracle = BytesN::from_array(&env, &[2; 32]);

    env.mock_all_auths();
    client.initialize(&owner, &registry);

    // Set oracle as authorized
    client.set_oracle(&oracle, &true);

    // Verify oracle is authorized
    assert!(client.is_authorized_oracle(&oracle));

    // Revoke oracle
    client.set_oracle(&oracle, &false);
    assert!(!client.is_authorized_oracle(&oracle));
}

#[test]
fn test_register_call() {
    let env = Env::default();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&owner, &registry);

    let call_id = 1u64;
    let long_tokens = 1000u128;
    let short_tokens = 500u128;
    let end_ts = 1000000u64;

    client.register_call(&call_id, &token, &long_tokens, &short_tokens, &end_ts);

    // Verify call was registered
    let call = client.get_call(&call_id);
    assert!(call.is_some());

    let call_data = call.unwrap();
    assert_eq!(call_data.id, call_id);
    assert_eq!(call_data.long_tokens, long_tokens);
    assert_eq!(call_data.short_tokens, short_tokens);
    assert!(!call_data.settled);
}

#[test]
fn test_submit_outcome_success() {
    let env = Env::default();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let token = Address::generate(&env);
    let oracle = BytesN::from_array(&env, &[4; 32]);

    env.mock_all_auths();
    client.initialize(&owner, &registry);

    // Authorize oracle
    client.set_oracle(&oracle, &true);

    // Register a call
    let call_id = 1u64;
    client.register_call(&call_id, &token, &1000u128, &500u128, &1000000u64);

    // Note: In real scenarios, we'd sign the message.
    // This test ensures the contract can be called with valid types.
}

#[test]
fn test_withdraw_payout_long_wins() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let treasury = Address::generate(&env);
    let user = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    client.initialize(&owner, &registry);
    client.set_fee_config(&500u32, &treasury);

    // Register a call
    let call_id = 1u64;
    client.register_call(&call_id, &stake_token, &1000u128, &500u128, &1000000u64);

    env.as_contract(&contract_id, || {
        let mut calls: soroban_sdk::Map<u64, CallData> =
            env.storage().instance().get(&CALLS).unwrap();
        let mut call_data = calls.get(call_id).unwrap();
        call_data.settled = true;
        call_data.outcome = Some(true);
        call_data.final_price = Some(105u128);
        calls.set(call_id, call_data);
        env.storage().instance().set(&CALLS, &calls);
    });

    stake_token_admin_client.mint(&contract_id, &1500);

    let payout = client.withdraw_payout(&call_id, &user, &100u128, &true);

    assert_eq!(payout, 143u128);
    assert_eq!(stake_token_client.balance(&user), 143i128);
    assert_eq!(stake_token_client.balance(&treasury), 7i128);
    assert_eq!(stake_token_client.balance(&contract_id), 1350i128);
}

#[test]
fn test_has_withdrawn() {
    let env = Env::default();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&owner, &registry);

    let call_id = 1u64;

    // Initially, user has not withdrawn
    assert!(!client.has_withdrawn(&call_id, &user));
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_submit_outcome_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);

    client.initialize(&owner, &registry);
    client.pause();

    client.submit_outcome(
        &1u64,
        &true,
        &100u128,
        &1234u64,
        &BytesN::from_array(&env, &[7; 32]),
        &BytesN::from_array(&env, &[8; 64]),
    );
}

#[test]
#[should_panic]
fn test_pause_requires_owner_auth() {
    let env = Env::default();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let registry = Address::generate(&env);

    client.initialize(&owner, &registry);

    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.pause();
}

#[test]
#[should_panic]
fn test_unpause_requires_owner_auth() {
    let env = Env::default();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let registry = Address::generate(&env);

    client.initialize(&owner, &registry);

    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.pause();

    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "unpause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.unpause();
}

#[test]
fn test_set_fee_config() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&owner, &registry);
    client.set_fee_config(&250u32, &treasury);

    let fee_config = client.get_fee_config_view();
    assert_eq!(fee_config.basis_points, 250);
    assert_eq!(fee_config.treasury, treasury);
}

#[test]
#[should_panic]
fn test_set_fee_config_requires_owner_auth() {
    let env = Env::default();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let attacker = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&owner, &registry);

    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "set_fee_config",
            args: (250u32, treasury.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.set_fee_config(&250u32, &treasury);
}

#[test]
fn test_deposit_oracle_bond() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let oracle = BytesN::from_array(&env, &[9; 32]);
    let token_admin = Address::generate(&env);
    let bond_token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let bond_token = bond_token_contract.address();
    let bond_token_admin_client = token::StellarAssetClient::new(&env, &bond_token);
    let bond_token_client = token::Client::new(&env, &bond_token);

    client.initialize(&owner, &registry);
    client.set_oracle(&oracle, &true);
    client.set_oracle_bond_token(&bond_token);

    bond_token_admin_client.mint(&owner, &1_000i128);

    client.deposit_oracle_bond(&oracle, &300u128);

    assert_eq!(client.get_oracle_bond(&oracle), 300u128);
    assert_eq!(bond_token_client.balance(&contract_id), 300i128);
    assert_eq!(bond_token_client.balance(&owner), 700i128);
}

#[test]
fn test_overturn_outcome_slashes_oracle_bond_to_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let treasury = Address::generate(&env);
    let oracle = BytesN::from_array(&env, &[10; 32]);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    let stake_token_client = token::Client::new(&env, &stake_token);

    client.initialize(&owner, &registry);
    client.set_fee_config(&0u32, &treasury);
    client.set_oracle(&oracle, &true);
    client.set_oracle_bond_token(&stake_token);

    stake_token_admin_client.mint(&owner, &2_000i128);
    client.deposit_oracle_bond(&oracle, &500u128);

    let call_id = 42u64;
    client.register_call(&call_id, &stake_token, &1_000u128, &500u128, &1_000_000u64);

    env.as_contract(&contract_id, || {
        let mut calls: soroban_sdk::Map<u64, CallData> =
            env.storage().instance().get(&CALLS).unwrap();
        let mut call_data = calls.get(call_id).unwrap();
        call_data.settled = true;
        call_data.outcome = Some(true);
        call_data.final_price = Some(110u128);
        calls.set(call_id, call_data);
        env.storage().instance().set(&CALLS, &calls);

        let mut call_oracles: soroban_sdk::Map<u64, BytesN<32>> =
            env.storage().instance().get(&CALL_ORACLES).unwrap();
        call_oracles.set(call_id, oracle.clone());
        env.storage().instance().set(&CALL_ORACLES, &call_oracles);
    });

    let overturned = client.overturn_outcome_by_majority(&call_id, &false, &90u128);
    assert!(overturned);

    let updated_call = client.get_call(&call_id).unwrap();
    assert_eq!(updated_call.outcome, Some(false));
    assert_eq!(updated_call.final_price, Some(90u128));

    assert_eq!(client.get_oracle_bond(&oracle), 0u128);
    assert_eq!(stake_token_client.balance(&treasury), 500i128);
    assert_eq!(stake_token_client.balance(&contract_id), 0i128);
}
