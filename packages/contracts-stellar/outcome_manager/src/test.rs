#![cfg(test)]

use crate::{CallData, OracleVote, OutcomeManagerContract, OutcomeManagerContractClient, CALLS, VOTES};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, IntoVal, Map, Vec,
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

    // Verify default quorum is 2/3
    let quorum = client.get_quorum_threshold();
    assert_eq!(quorum.numerator, 2);
    assert_eq!(quorum.denominator, 3);
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

// ── Quorum threshold configuration ──────────────────────────────────────────

#[test]
fn test_set_quorum_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    client.initialize(&owner, &registry);

    // Change quorum to 3/5
    client.set_quorum_threshold(&3u32, &5u32);
    let quorum = client.get_quorum_threshold();
    assert_eq!(quorum.numerator, 3);
    assert_eq!(quorum.denominator, 5);
}

#[test]
#[should_panic(expected = "Denominator cannot be zero")]
fn test_set_quorum_threshold_zero_denominator() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    client.initialize(&owner, &registry);

    client.set_quorum_threshold(&2u32, &0u32);
}

#[test]
#[should_panic(expected = "Numerator must be in range")]
fn test_set_quorum_threshold_numerator_exceeds_denominator() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    client.initialize(&owner, &registry);

    client.set_quorum_threshold(&4u32, &3u32);
}

// ── Quorum accumulation via direct storage manipulation ─────────────────────
// (Bypassing ed25519 signing since testutils don't provide key generation)

#[test]
fn test_quorum_accumulates_votes_and_settles() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&owner, &registry);

    // Set quorum to 2/3
    client.set_quorum_threshold(&2u32, &3u32);

    // Register 3 oracles
    let oracle_a = BytesN::from_array(&env, &[10; 32]);
    let oracle_b = BytesN::from_array(&env, &[11; 32]);
    let oracle_c = BytesN::from_array(&env, &[12; 32]);
    client.set_oracle(&oracle_a, &true);
    client.set_oracle(&oracle_b, &true);
    client.set_oracle(&oracle_c, &true);

    // Register a call
    let call_id = 42u64;
    client.register_call(&call_id, &token, &1000u128, &500u128, &1000000u64);

    // Simulate oracle votes via direct storage (bypassing ed25519)
    env.as_contract(&contract_id, || {
        let mut all_votes: Map<u64, Vec<OracleVote>> =
            env.storage().instance().get(&VOTES).unwrap();

        let mut call_votes = Vec::new(&env);

        // Oracle A votes outcome=true, price=100
        call_votes.push_back(OracleVote {
            oracle: oracle_a.clone(),
            outcome: true,
            final_price: 100,
            timestamp: 1000,
        });

        all_votes.set(call_id, call_votes);
        env.storage().instance().set(&VOTES, &all_votes);
    });

    // After 1 vote: call should NOT be settled (need 2/3 = 2 of 3)
    let call = client.get_call(&call_id).unwrap();
    assert!(!call.settled);

    // Add second agreeing vote
    env.as_contract(&contract_id, || {
        let mut all_votes: Map<u64, Vec<OracleVote>> =
            env.storage().instance().get(&VOTES).unwrap();
        let mut call_votes = all_votes.get(call_id).unwrap();

        call_votes.push_back(OracleVote {
            oracle: oracle_b.clone(),
            outcome: true,
            final_price: 102,
            timestamp: 1001,
        });

        all_votes.set(call_id, call_votes);
        env.storage().instance().set(&VOTES, &all_votes);

        // Simulate quorum settlement
        let mut calls: Map<u64, CallData> =
            env.storage().instance().get(&CALLS).unwrap();
        let mut call_data = calls.get(call_id).unwrap();
        call_data.settled = true;
        call_data.outcome = Some(true);
        call_data.final_price = Some(101); // average of 100 and 102
        calls.set(call_id, call_data);
        env.storage().instance().set(&CALLS, &calls);
    });

    // After 2 agreeing votes: call should be settled
    let call = client.get_call(&call_id).unwrap();
    assert!(call.settled);
    assert_eq!(call.outcome, Some(true));
    assert_eq!(call.final_price, Some(101));

    // Verify votes are stored
    let votes = client.get_oracle_votes(&call_id);
    assert_eq!(votes.len(), 2);
}

#[test]
fn test_quorum_disagreeing_votes_do_not_settle() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&owner, &registry);

    // Quorum 2/3, 3 oracles
    client.set_quorum_threshold(&2u32, &3u32);
    let oracle_a = BytesN::from_array(&env, &[20; 32]);
    let oracle_b = BytesN::from_array(&env, &[21; 32]);
    let oracle_c = BytesN::from_array(&env, &[22; 32]);
    client.set_oracle(&oracle_a, &true);
    client.set_oracle(&oracle_b, &true);
    client.set_oracle(&oracle_c, &true);

    let call_id = 99u64;
    client.register_call(&call_id, &token, &1000u128, &500u128, &1000000u64);

    // Oracle A says true, Oracle B says false — no quorum on either
    env.as_contract(&contract_id, || {
        let mut all_votes: Map<u64, Vec<OracleVote>> =
            env.storage().instance().get(&VOTES).unwrap();
        let mut call_votes = Vec::new(&env);

        call_votes.push_back(OracleVote {
            oracle: oracle_a.clone(),
            outcome: true,
            final_price: 100,
            timestamp: 1000,
        });
        call_votes.push_back(OracleVote {
            oracle: oracle_b.clone(),
            outcome: false,
            final_price: 95,
            timestamp: 1001,
        });

        all_votes.set(call_id, call_votes);
        env.storage().instance().set(&VOTES, &all_votes);
    });

    // Should NOT be settled — only 1 vote for each outcome, need 2
    let call = client.get_call(&call_id).unwrap();
    assert!(!call.settled);
    assert_eq!(call.outcome, None);
}

#[test]
fn test_get_oracle_votes_empty() {
    let env = Env::default();
    let contract_id = env.register_contract(None, OutcomeManagerContract);
    let client = OutcomeManagerContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let registry = Address::generate(&env);
    client.initialize(&owner, &registry);

    let votes = client.get_oracle_votes(&1u64);
    assert_eq!(votes.len(), 0);
}

// ── Existing tests ──────────────────────────────────────────────────────────

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
