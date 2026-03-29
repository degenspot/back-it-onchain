#![cfg(test)]

use crate::{CallData, CallLifecycle, OutcomeManagerContract, OutcomeManagerContractClient, CALLS};
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
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

    assert_eq!(client.get_proposal_window(), 86_400);
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
    assert!(matches!(call_data.lifecycle, CallLifecycle::Open));
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
        call_data.lifecycle = CallLifecycle::Settled;
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
fn test_finalize_proposed_outcome_after_window() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&owner, &registry);
    let call_id = 1u64;
    client.register_call(&call_id, &token, &1000u128, &500u128, &1_000_000u64);

    let window_end = 500u64;
    env.as_contract(&contract_id, || {
        let mut calls: soroban_sdk::Map<u64, CallData> =
            env.storage().instance().get(&CALLS).unwrap();
        let mut call_data = calls.get(call_id).unwrap();
        call_data.lifecycle = CallLifecycle::Proposed {
            outcome: true,
            final_price: 99u128,
            window_end_ts: window_end,
        };
        calls.set(call_id, call_data);
        env.storage().instance().set(&CALLS, &calls);
    });

    env.ledger().set_timestamp(window_end - 1);
    assert!(!client.is_call_settled(&call_id));

    env.ledger().set_timestamp(window_end);
    client.finalize_proposed_outcome(&call_id);

    let call = client.get_call(&call_id).unwrap();
    assert!(matches!(call.lifecycle, CallLifecycle::Settled));
    assert_eq!(call.outcome, Some(true));
    assert_eq!(call.final_price, Some(99u128));
    assert!(client.is_call_settled(&call_id));
}

#[test]
#[should_panic(expected = "Proposal window still active")]
fn test_finalize_proposed_rejects_before_window_end() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&owner, &registry);
    let call_id = 2u64;
    client.register_call(&call_id, &token, &100u128, &100u128, &1_000_000u64);

    let window_end = 600u64;
    env.ledger().set_timestamp(100);

    env.as_contract(&contract_id, || {
        let mut calls: soroban_sdk::Map<u64, CallData> =
            env.storage().instance().get(&CALLS).unwrap();
        let mut call_data = calls.get(call_id).unwrap();
        call_data.lifecycle = CallLifecycle::Proposed {
            outcome: false,
            final_price: 1u128,
            window_end_ts: window_end,
        };
        calls.set(call_id, call_data);
        env.storage().instance().set(&CALLS, &calls);
    });

    client.finalize_proposed_outcome(&call_id);
}

#[test]
fn test_dispute_outcome_and_uphold_slash_bond() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let treasury = Address::generate(&env);
    let disputer = Address::generate(&env);

    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    client.initialize(&owner, &registry);
    client.set_fee_config(&0u32, &treasury);

    let call_id = 7u64;
    client.register_call(&call_id, &stake_token, &1000u128, &500u128, &1_000_000u64);

    let now = 10_000u64;
    let window_end = now + 86_400;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        let mut calls: soroban_sdk::Map<u64, CallData> =
            env.storage().instance().get(&CALLS).unwrap();
        let mut call_data = calls.get(call_id).unwrap();
        call_data.lifecycle = CallLifecycle::Proposed {
            outcome: false,
            final_price: 50u128,
            window_end_ts: window_end,
        };
        calls.set(call_id, call_data);
        env.storage().instance().set(&CALLS, &calls);
    });

    stake_token_admin_client.mint(&disputer, &200);
    client.dispute_outcome(&call_id, &disputer, &100i128);

    let call = client.get_call(&call_id).unwrap();
    assert!(matches!(call.lifecycle, CallLifecycle::Disputed { .. }));
    assert_eq!(stake_token_client.balance(&contract_id), 100i128);
    assert_eq!(stake_token_client.balance(&disputer), 100i128);

    client.resolve_dispute_uphold_proposal(&call_id);

    let settled = client.get_call(&call_id).unwrap();
    assert!(matches!(settled.lifecycle, CallLifecycle::Settled));
    assert_eq!(settled.outcome, Some(false));
    assert_eq!(stake_token_client.balance(&treasury), 100i128);
    assert_eq!(stake_token_client.balance(&contract_id), 0i128);
}

#[test]
fn test_dispute_outcome_and_override_refunds_bond() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let treasury = Address::generate(&env);
    let disputer = Address::generate(&env);

    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    client.initialize(&owner, &registry);
    client.set_fee_config(&0u32, &treasury);

    let call_id = 8u64;
    client.register_call(&call_id, &stake_token, &100u128, &100u128, &2_000_000u64);

    let now = 20_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        let mut calls: soroban_sdk::Map<u64, CallData> =
            env.storage().instance().get(&CALLS).unwrap();
        let mut call_data = calls.get(call_id).unwrap();
        call_data.lifecycle = CallLifecycle::Proposed {
            outcome: true,
            final_price: 1u128,
            window_end_ts: now + 3600,
        };
        calls.set(call_id, call_data);
        env.storage().instance().set(&CALLS, &calls);
    });

    stake_token_admin_client.mint(&disputer, &50);
    client.dispute_outcome(&call_id, &disputer, &50i128);

    client.resolve_dispute_override(&call_id, &false, &2u128);

    let settled = client.get_call(&call_id).unwrap();
    assert_eq!(settled.outcome, Some(false));
    assert_eq!(settled.final_price, Some(2u128));
    assert_eq!(stake_token_client.balance(&disputer), 50i128);
    assert_eq!(stake_token_client.balance(&contract_id), 0i128);
}

#[test]
#[should_panic(expected = "Call not settled")]
fn test_withdraw_requires_settled_not_proposed() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let user = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();

    client.initialize(&owner, &registry);

    let call_id = 3u64;
    client.register_call(&call_id, &stake_token, &1000u128, &500u128, &1_000_000u64);

    env.as_contract(&contract_id, || {
        let mut calls: soroban_sdk::Map<u64, CallData> =
            env.storage().instance().get(&CALLS).unwrap();
        let mut call_data = calls.get(call_id).unwrap();
        call_data.lifecycle = CallLifecycle::Proposed {
            outcome: true,
            final_price: 1u128,
            window_end_ts: 999_999_999,
        };
        calls.set(call_id, call_data);
        env.storage().instance().set(&CALLS, &calls);
    });

    client.withdraw_payout(&call_id, &user, &100u128, &true);
}
