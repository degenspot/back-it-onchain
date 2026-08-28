#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    vec, Address, BytesN, Env, IntoVal, String, Symbol,
};

fn default_metadata(env: &Env) -> CreateCallMetadata {
    CreateCallMetadata {
        token_address: Address::generate(env),
        pair_id: BytesN::from_array(env, &[0; 32]),
        ipfs_cid: String::from_str(env, "QmHash"),
        num_outcomes: 2, // binary market
    }
}

// ΓöÇΓöÇ Existing tests (preserved) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

#[test]
fn test_create_call() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    assert_eq!(call_id, 0);
    let call = client.get_call(&call_id);
    assert_eq!(call.creator, creator);
    assert_eq!(call.outcome_pools.len(), 2);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 100);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 0);
    assert_eq!(call.participant_count, 1);

    let stake = client.get_user_stake(&call_id, &creator, &0u32);
    assert_eq!(stake, 100);

    assert_eq!(stake_token_client.balance(&creator), 900);
    assert_eq!(stake_token_client.balance(&contract_id), 100);

    let events = env.events().all();
    let last_event = events.last().unwrap();
    let symbol: Symbol = last_event.1.get(0).unwrap().into_val(&env);
    assert_eq!(symbol, Symbol::new(&env, "CallCreated"));
}

#[test]
#[should_panic]
fn test_create_call_requires_creator_auth() {
    // #314 ΓÇö create_call must reject a call that isn't authorized by the
    // declared creator, even if some other address's auth is mocked.
    let env = Env::default();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "initialize",
            args: (&admin,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);

    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "whitelist_token_admin",
            args: (&stake_token,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.whitelist_token_admin(&stake_token);

    // No auth mocked for `creator` at all ΓÇö create_call must panic on
    // `creator.require_auth()` before any state or token transfer happens.
    let end_ts = env.ledger().timestamp() + 1000;
    client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );
}

#[test]
fn test_stake_on_call() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &1000);
    stake_token_admin_client.mint(&staker, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    client.stake_on_call(&call_id, &staker, &1000, &1u32);

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 100);
    // 50 bp fee on 1000 = 5; net = 995
    assert_eq!(call.outcome_pools.get(1).unwrap(), 995);
    assert_eq!(call.participant_count, 2);
}

#[test]
#[should_panic(expected = "End time must be in future")]
fn test_create_call_past_end_time() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    client.whitelist_token_admin(&stake_token);
    client.create_call(
        &creator,
        &stake_token,
        &100,
        &env.ledger().timestamp(),
        &default_metadata(&env),
    );
}

#[test]
#[should_panic(expected = "Call ended")]
fn test_stake_ended_call() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    stake_token_admin_client.mint(&staker, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 100;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );
    env.ledger().set_timestamp(end_ts + 1);
    client.stake_on_call(&call_id, &staker, &50, &1u32);
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_create_call_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.pause();

    let creator = Address::generate(&env);
    let stake_token = Address::generate(&env);
    client.create_call(
        &creator,
        &stake_token,
        &100,
        &(env.ledger().timestamp() + 1000),
        &default_metadata(&env),
    );
}

#[test]
fn test_pause_unpause_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    assert!(!client.get_is_paused());

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    stake_token_admin_client.mint(&staker, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    client.pause();
    assert!(client.get_is_paused());
    client.unpause();
    assert!(!client.get_is_paused());

    client.stake_on_call(&call_id, &staker, &50, &1u32);
}

#[test]
#[should_panic]
fn test_pause_requires_admin_auth() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "initialize",
            args: (&admin,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.initialize(&admin);

    let attacker = Address::generate(&env);
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
fn test_unpause_requires_admin_auth() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "initialize",
            args: (&admin,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.initialize(&admin);

    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.pause();

    let attacker = Address::generate(&env);
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

// ΓöÇΓöÇ Issue #161: Dynamic surge fee ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

#[test]
fn test_surge_fee_basis_points() {
    // 0 participants ΓåÆ 50 bp
    assert_eq!(compute_fee_basis_points(0), 50);
    // 10 participants ΓåÆ 55 bp
    assert_eq!(compute_fee_basis_points(10), 55);
    // 100 participants ΓåÆ 100 bp
    assert_eq!(compute_fee_basis_points(100), 100);
    // 300 participants ΓåÆ capped at 200 bp
    assert_eq!(compute_fee_basis_points(300), 200);
    // 1000 participants ΓåÆ still capped at 200 bp
    assert_eq!(compute_fee_basis_points(1000), 200);
}

#[test]
fn test_stake_applies_surge_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &10_000);
    stake_token_admin_client.mint(&staker, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // participant_count = 1 ΓåÆ fee_bps = 50; stake 10_000 ΓåÆ fee = 50, net = 9_950
    client.stake_on_call(&call_id, &staker, &10_000, &1u32);

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 9_950);
    assert_eq!(call.participant_count, 2);

    // Platform fees should have accumulated
    let fees = client.get_platform_fees();
    assert_eq!(fees, 50);
}

#[test]
fn test_get_fee_basis_points() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // 1 participant ΓåÆ 50 bp
    assert_eq!(client.get_fee_basis_points(&call_id), 50);
}

// ΓöÇΓöÇ Issue #160: distribute_dividends ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

#[test]
fn test_distribute_dividends() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &10_000);
    stake_token_admin_client.mint(&staker, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // Stake to generate fees: 10_000 * 50bp / 10_000 = 50 fee
    client.stake_on_call(&call_id, &staker, &10_000, &1u32);
    assert_eq!(client.get_platform_fees(), 50);

    let holder_a = Address::generate(&env);
    let holder_b = Address::generate(&env);

    // Distribute: holder_a has weight 3, holder_b has weight 2 ΓåÆ total 5
    // holder_a gets 50 * 3/5 = 30, holder_b gets 50 * 2/5 = 20
    let stakers = vec![&env, (holder_a.clone(), 3i128), (holder_b.clone(), 2i128)];
    client.distribute_dividends(&stake_token, &stakers);

    assert_eq!(stake_token_client.balance(&holder_a), 30);
    assert_eq!(stake_token_client.balance(&holder_b), 20);
    assert_eq!(client.get_platform_fees(), 0);
}

#[test]
#[should_panic(expected = "No fees to distribute")]
fn test_distribute_dividends_no_fees() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();

    let holder = Address::generate(&env);
    let stakers = vec![&env, (holder.clone(), 1i128)];
    client.distribute_dividends(&stake_token, &stakers);
}

// ΓöÇΓöÇ Issue #170: Decentralized Token Whitelisting ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

#[test]
fn test_propose_and_vouch_whitelist() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let staker1 = Address::generate(&env);
    let staker2 = Address::generate(&env);
    let staker3 = Address::generate(&env);
    client.add_authorized_staker(&staker1);
    client.add_authorized_staker(&staker2);
    client.add_authorized_staker(&staker3);

    let token = Address::generate(&env);
    let proposer = Address::generate(&env);

    // Token not yet whitelisted
    assert!(!client.is_token_whitelisted(&token));

    client.propose_token(&proposer, &token);

    // Two vouches ΓÇö not yet whitelisted
    client.vouch_for_token(&staker1, &token);
    assert!(!client.is_token_whitelisted(&token));
    client.vouch_for_token(&staker2, &token);
    assert!(!client.is_token_whitelisted(&token));

    // Third vouch ΓåÆ auto-whitelisted
    client.vouch_for_token(&staker3, &token);
    assert!(client.is_token_whitelisted(&token));
}

#[test]
fn test_duplicate_vouch_ignored() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let staker = Address::generate(&env);
    client.add_authorized_staker(&staker);

    let token = Address::generate(&env);
    let proposer = Address::generate(&env);
    client.propose_token(&proposer, &token);

    // Same staker vouches twice ΓÇö only one counted
    client.vouch_for_token(&staker, &token);
    client.vouch_for_token(&staker, &token);

    // Still only 1 vouch, not whitelisted
    assert!(!client.is_token_whitelisted(&token));
    let proposal = client.get_token_proposal(&token);
    assert_eq!(proposal.vouches.len(), 1);
}

#[test]
#[should_panic(expected = "Not an authorized staker")]
fn test_vouch_requires_authorized_staker() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let token = Address::generate(&env);
    let proposer = Address::generate(&env);
    client.propose_token(&proposer, &token);

    let random = Address::generate(&env);
    client.vouch_for_token(&random, &token);
}

#[test]
fn test_admin_whitelist_bypass() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let token = Address::generate(&env);
    assert!(!client.is_token_whitelisted(&token));
    client.whitelist_token_admin(&token);
    assert!(client.is_token_whitelisted(&token));
    client.remove_whitelisted_token(&token);
    assert!(!client.is_token_whitelisted(&token));
}

#[test]
#[should_panic(expected = "Token not whitelisted")]
fn test_create_call_rejects_non_whitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);

    // No whitelist call ΓÇö should panic
    client.create_call(
        &creator,
        &stake_token,
        &100,
        &(env.ledger().timestamp() + 1000),
        &default_metadata(&env),
    );
}

// ΓöÇΓöÇ Issue #169: Storage TTL & Archival ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

#[test]
fn test_archive_settled_call() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 100;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // Advance time and finalize
    env.ledger().set_timestamp(end_ts + 1);
    client.finalize_call(&call_id, &0u32, &1000i128, &creator);

    let call = client.get_call(&call_id);
    assert!(call.settled);

    // Archive should succeed
    client.archive_call(&call_id);
}

#[test]
#[should_panic(expected = "Call not yet settled")]
fn test_archive_unsettled_call_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 100;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    client.archive_call(&call_id);
}

// ΓöÇΓöÇ Early Exit (Hedging / Position Closing) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

#[test]
fn test_exit_early_yes_position() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // Creator exits early from YES position: stake = 100
    // Refund = 100 * 80 / 100 = 80
    // Remaining in pool = 20 (goes to NO side)
    client.exit_early(&call_id, &creator);

    // User should have received 80 back (started with 1000, paid 100, got 80 back = 980)
    assert_eq!(stake_token_client.balance(&creator), 980);

    // Contract should hold 20 (the penalty)
    assert_eq!(stake_token_client.balance(&contract_id), 20);

    // Call totals: outcome 0 = 0 (full stake removed), outcome 1 = 20 (penalty added)
    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 0);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 20);
    assert_eq!(call.vault_balance, 20);

    // User stake should be removed
    assert_eq!(client.get_user_stake(&call_id, &creator, &0u32), 0);
}

#[test]
fn test_exit_early_no_position() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    stake_token_admin_client.mint(&staker, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // Staker stakes 1000 on outcome 1 (net after 50bp fee = 995)
    client.stake_on_call(&call_id, &staker, &1000, &1u32);

    // Staker exits early from outcome 1: stake = 995
    // Refund = 995 * 80 / 100 = 796
    // Remaining = 995 - 796 = 199 (goes to outcome 0 side)
    let staker_balance_before = stake_token_client.balance(&staker);
    client.exit_early(&call_id, &staker);
    let staker_balance_after = stake_token_client.balance(&staker);

    assert_eq!(staker_balance_after - staker_balance_before, 796);

    // Call totals: outcome 0 = 100 + 199 (penalty), outcome 1 = 0 (full stake removed)
    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 299); // 100 original + 199 penalty
    assert_eq!(call.outcome_pools.get(1).unwrap(), 0);

    // User stake should be removed
    assert_eq!(client.get_user_stake(&call_id, &staker, &1u32), 0);
}

#[test]
#[should_panic(expected = "No stake found")]
fn test_exit_early_no_stake() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let rando = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // rando has no stake ΓÇö should panic
    client.exit_early(&call_id, &rando);
}

#[test]
#[should_panic(expected = "Call ended")]
fn test_exit_early_after_end_time() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 100;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // Advance time past end
    env.ledger().set_timestamp(end_ts + 1);
    client.exit_early(&call_id, &creator);
}

#[test]
#[should_panic(expected = "Call settled")]
fn test_exit_early_after_settled() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 100;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // Finalize the call
    env.ledger().set_timestamp(end_ts + 1);
    client.finalize_call(&call_id, &0u32, &1000i128, &creator);

    // Try to exit early ΓÇö should panic
    client.exit_early(&call_id, &creator);
}

#[test]
fn test_exit_early_event_emitted() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    client.exit_early(&call_id, &creator);

    // Verify the EarlyExit event was emitted
    let events = env.events().all();
    let last_event = events.last().unwrap();
    let symbol: Symbol = last_event.1.get(0).unwrap().into_val(&env);
    assert_eq!(symbol, Symbol::new(&env, "EarlyExit"));
}

#[test]
fn test_exit_early_multiple_stakers() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker_yes = Address::generate(&env);
    let staker_no = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    stake_token_admin_client.mint(&staker_yes, &10_000);
    stake_token_admin_client.mint(&staker_no, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    // Creator stakes 100 on YES
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // staker_yes stakes 200 on outcome 0 (net after 50bp fee with participant_count=1: 200 - 1 = 199)
    client.stake_on_call(&call_id, &staker_yes, &200, &0u32);

    // staker_no stakes 500 on outcome 1 (net after 50bp fee with participant_count=2: 500 - 2 = 498)
    client.stake_on_call(&call_id, &staker_no, &500, &1u32);

    // Verify initial state
    let call = client.get_call(&call_id);
    // outcome 0: 100 (creator) + 199 (staker_yes net) = 299
    assert_eq!(call.outcome_pools.get(0).unwrap(), 299);
    // outcome 1: 498 (staker_no net)
    assert_eq!(call.outcome_pools.get(1).unwrap(), 498);

    // staker_no exits early from outcome 1: stake = 498
    // Refund = 498 * 80 / 100 = 398
    // Remaining = 498 - 398 = 100 (goes to outcome 0 side)
    let staker_no_balance_before = stake_token_client.balance(&staker_no);
    client.exit_early(&call_id, &staker_no);
    let staker_no_balance_after = stake_token_client.balance(&staker_no);
    assert_eq!(staker_no_balance_after - staker_no_balance_before, 398);

    // After exit: outcome 0 = 299 + 100 (penalty from outcome 1) = 399, outcome 1 = 0
    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 399);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 0);

    // Creator and staker_yes still have their stakes
    assert_eq!(client.get_user_stake(&call_id, &creator, &0u32), 100);
    assert_eq!(client.get_user_stake(&call_id, &staker_yes, &0u32), 199);
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_exit_early_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    client.pause();
    client.exit_early(&call_id, &creator);
}

// ΓöÇΓöÇ Multi-Outcome Markets (Scalar/Categorical) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

fn multi_metadata(env: &Env, num_outcomes: u32) -> CreateCallMetadata {
    CreateCallMetadata {
        token_address: Address::generate(env),
        pair_id: BytesN::from_array(env, &[0; 32]),
        ipfs_cid: String::from_str(env, "QmHash"),
        num_outcomes,
    }
}

#[test]
fn test_create_multi_outcome_call() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;

    // Create a 4-outcome market
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &multi_metadata(&env, 4),
    );

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.len(), 4);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 100); // creator stakes on outcome 0
    assert_eq!(call.outcome_pools.get(1).unwrap(), 0);
    assert_eq!(call.outcome_pools.get(2).unwrap(), 0);
    assert_eq!(call.outcome_pools.get(3).unwrap(), 0);
    assert_eq!(call.winning_outcome, u32::MAX); // not settled yet
}

#[test]
fn test_stake_on_multi_outcome() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker_a = Address::generate(&env);
    let staker_b = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    stake_token_admin_client.mint(&staker_a, &10_000);
    stake_token_admin_client.mint(&staker_b, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &multi_metadata(&env, 3),
    );

    // staker_a stakes on outcome 1 (50bp fee on 1000 = 5; net = 995)
    client.stake_on_call(&call_id, &staker_a, &1000, &1u32);
    // staker_b stakes on outcome 2 (50bp fee on 500 = 2; net = 498)
    client.stake_on_call(&call_id, &staker_b, &500, &2u32);

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 100); // creator
    assert_eq!(call.outcome_pools.get(1).unwrap(), 995); // staker_a net
    assert_eq!(call.outcome_pools.get(2).unwrap(), 498); // staker_b net
    assert_eq!(call.participant_count, 3);

    // Verify individual stakes
    assert_eq!(client.get_user_stake(&call_id, &creator, &0u32), 100);
    assert_eq!(client.get_user_stake(&call_id, &staker_a, &1u32), 995);
    assert_eq!(client.get_user_stake(&call_id, &staker_b, &2u32), 498);
}

#[test]
fn test_finalize_multi_outcome() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker_a = Address::generate(&env);
    let staker_b = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    stake_token_admin_client.mint(&staker_a, &10_000);
    stake_token_admin_client.mint(&staker_b, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 100;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &multi_metadata(&env, 3),
    );

    client.stake_on_call(&call_id, &staker_a, &1000, &1u32);
    client.stake_on_call(&call_id, &staker_b, &500, &2u32);

    // Advance time and finalize with outcome 1 as winner
    env.ledger().set_timestamp(end_ts + 1);
    client.finalize_call(&call_id, &1u32, &2000i128, &creator);

    let call = client.get_call(&call_id);
    assert!(call.settled);
    assert_eq!(call.winning_outcome, 1);
    assert_eq!(call.final_price, 2000);
}

#[test]
fn test_withdraw_multi_outcome() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker_a = Address::generate(&env);
    let staker_b = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    stake_token_admin_client.mint(&staker_a, &10_000);
    stake_token_admin_client.mint(&staker_b, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 100;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &multi_metadata(&env, 3),
    );

    // staker_a on outcome 1 (net 995), staker_b on outcome 2 (net 498)
    client.stake_on_call(&call_id, &staker_a, &1000, &1u32);
    client.stake_on_call(&call_id, &staker_b, &500, &2u32);

    // Finalize with outcome 1 as winner
    env.ledger().set_timestamp(end_ts + 1);
    client.finalize_call(&call_id, &1u32, &2000i128, &creator);

    // staker_a withdraws ΓÇö should get their stake + proportional share of losing pools
    // Winners pool = 995, losers pool = 100 + 498 = 598
    // Payout = 995 + (995 * 598 / 995) = 995 + 598 = 1593
    let balance_before = stake_token_client.balance(&staker_a);
    client.withdraw_payout(&call_id, &staker_a, &1u32);
    let balance_after = stake_token_client.balance(&staker_a);
    let payout = balance_after - balance_before;

    // Expected: 995 (principal) + (995 * 598 / 995) = 995 + 598 = 1593
    // But gas fee of 0.5% was deducted from losers pool (598 * 5/1000 = 2)
    // So actual losers_pool after fee = 598 - 2 = 596
    // Payout = 995 + (995 * 596 / 995) = 995 + 596 = 1591
    assert_eq!(payout, 1591);
}

#[test]
#[should_panic(expected = "Invalid outcome index")]
fn test_stake_invalid_outcome_index() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    stake_token_admin_client.mint(&staker, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &multi_metadata(&env, 3),
    );

    // Outcome index 5 is out of bounds for a 3-outcome market
    client.stake_on_call(&call_id, &staker, &100, &5u32);
}

#[test]
#[should_panic(expected = "Must have at least 2 outcomes")]
fn test_create_call_too_few_outcomes() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &multi_metadata(&env, 1),
    );
}

#[test]
#[should_panic(expected = "Too many outcomes")]
fn test_create_call_too_many_outcomes() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &multi_metadata(&env, 33),
    );
}

#[test]
fn test_exit_early_multi_outcome() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker_a = Address::generate(&env);
    let staker_b = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);

    stake_token_admin_client.mint(&creator, &10_000);
    stake_token_admin_client.mint(&staker_a, &10_000);
    stake_token_admin_client.mint(&staker_b, &10_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &multi_metadata(&env, 4),
    );

    // Stake on different outcomes
    client.stake_on_call(&call_id, &staker_a, &1000, &1u32); // net 995
    client.stake_on_call(&call_id, &staker_b, &500, &2u32); // net 498

    // staker_a exits early from outcome 1
    // stake = 995, refund = 995 * 80 / 100 = 796, remaining = 199
    let balance_before = stake_token_client.balance(&staker_a);
    client.exit_early(&call_id, &staker_a);
    let balance_after = stake_token_client.balance(&staker_a);
    assert_eq!(balance_after - balance_before, 796);

    // Outcome 1 pool should be 0, penalty distributed to other pools proportionally
    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 0);
    // Other pools (0, 2, 3) should have the 199 penalty distributed proportionally
    // outcome 0 = 100, outcome 2 = 498, outcome 3 = 0 ΓåÆ total other = 598
    // outcome 0 gets: 100 + 199 * 100 / 598 = 100 + 33 = 133
    // outcome 2 gets: 498 + 199 * 498 / 598 = 498 + 165 = 663
    // outcome 3 gets: 0 (no existing stake, no share)
    assert_eq!(call.outcome_pools.get(0).unwrap(), 133);
    assert_eq!(call.outcome_pools.get(2).unwrap(), 663);
    assert_eq!(call.outcome_pools.get(3).unwrap(), 0);
}

fn test_surge_fee_boundaries() {
    // Exact boundary values around each 10-participant step.
    //         participants ΓåÆ fee bps
    assert_eq!(compute_fee_basis_points(0), 50); //  0 ΓåÆ  50
    assert_eq!(compute_fee_basis_points(9), 50); //  9 ΓåÆ  50
    assert_eq!(compute_fee_basis_points(10), 55); // 10 ΓåÆ  55
    assert_eq!(compute_fee_basis_points(19), 55); // 19 ΓåÆ  55
    assert_eq!(compute_fee_basis_points(20), 60); // 20 ΓåÆ  60
    assert_eq!(compute_fee_basis_points(99), 95); // 99 ΓåÆ  95
    assert_eq!(compute_fee_basis_points(100), 100); // 100 ΓåÆ 100
    assert_eq!(compute_fee_basis_points(299), 195); // 299 ΓåÆ 195
    assert_eq!(compute_fee_basis_points(300), 200); // 300 ΓåÆ 200 (cap)
    assert_eq!(compute_fee_basis_points(301), 200); // 301 ΓåÆ 200 (cap)
}

#[test]
fn test_fee_never_exceeds_200() {
    // Property test: for any participant count 0..500 the fee never dips below
    // the 50 bp base nor rises above the 200 bp cap.
    for count in 0..500u32 {
        let fee = compute_fee_basis_points(count);
        assert!(
            (50..=200).contains(&fee),
            "fee {} out of [50, 200] for participant_count {}",
            fee,
            count
        );
    }
}

// ── Issue #319 (SC-006): Phoenix-compatible vault yield layer ─────────────────

// Minimal no-op vault contract so the contract's vault_deposit / vault_withdraw
// calls resolve against a real (registered) address without needing an external
// lending protocol.
#[contract]
struct MockVault;

#[contractimpl]
impl MockVault {
    pub fn deposit(_env: Env, _from: Address, _amount: i128) {}
    pub fn withdraw(_env: Env, _to: Address, _amount: i128) {}
}

#[test]
fn test_vault_deposit_on_create() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let mock_vault_id = env.register_contract(None, MockVault);
    client.set_vault(&mock_vault_id);

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // The creator's stake is mirrored into the vault_balance tracking.
    let call = client.get_call(&call_id);
    assert_eq!(call.vault_balance, 100);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 100);
}

#[test]
fn test_vault_deposit_on_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let mock_vault_id = env.register_contract(None, MockVault);
    client.set_vault(&mock_vault_id);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    stake_token_admin_client.mint(&staker, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // participant_count = 1 ΓåÆ 50 bp; stake 1000 ΓåÆ fee 5, net 995
    client.stake_on_call(&call_id, &staker, &1000, &1u32);

    let call = client.get_call(&call_id);
    // vault_balance increased by the net_amount (995): 100 + 995 = 1095
    assert_eq!(call.vault_balance, 1095);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 995);
    assert_eq!(call.participant_count, 2);
}

#[test]
fn test_vault_withdraw_on_finalize() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let mock_vault_id = env.register_contract(None, MockVault);
    client.set_vault(&mock_vault_id);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_client = token::Client::new(&env, &stake_token);
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    stake_token_admin_client.mint(&staker, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // Staker backs the losing side (outcome 1): 1000 ΓåÆ net 995
    client.stake_on_call(&call_id, &staker, &1000, &1u32);

    let staker_balance_before = stake_token_client.balance(&staker);

    // Finalize with outcome 0 winning: losers_pool = 995 ΓåÆ gas_fee = 4
    env.ledger().set_timestamp(end_ts + 1);
    client.finalize_call(&call_id, &0u32, &2000i128, &creator);

    let call = client.get_call(&call_id);
    assert!(call.settled);

    // Vault balance before finalize = 100 + 995 = 1095; gas_fee 4 withdrawn ΓåÆ 1091
    assert_eq!(call.vault_balance, 1091);

    // The gas fee was paid out to the caller from the contract's pocket
    // (the mock vault withdraw makes the funds available for transfer).
    let caller_gain = stake_token_client.balance(&creator) - (1000 - 100);
    assert_eq!(caller_gain, 4);

    // The losing staker never got anything yet.
    assert_eq!(stake_token_client.balance(&staker), staker_balance_before);
}

#[test]
#[should_panic]
fn test_set_vault_requires_admin() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "initialize",
            args: (&admin,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.initialize(&admin);

    // A non-admin user tries to set the vault ΓÇö must panic on admin.require_auth.
    let attacker = Address::generate(&env);
    let vault = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "set_vault",
            args: (&vault,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.set_vault(&vault);
}

#[test]
fn test_no_vault_path_unchanged() {
    // Baseline: without any vault configured, the full lifecycle still works and
    // vault_balance tracking behaves exactly as before.
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    stake_token_admin_client.mint(&staker, &1000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    let call = client.get_call(&call_id);
    assert_eq!(call.vault_balance, 100);

    client.stake_on_call(&call_id, &staker, &1000, &1u32);
    let call = client.get_call(&call_id);
    assert_eq!(call.vault_balance, 1095);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 995);

    env.ledger().set_timestamp(end_ts + 1);
    client.finalize_call(&call_id, &0u32, &2000i128, &creator);
    let call = client.get_call(&call_id);
    assert!(call.settled);
    assert_eq!(call.vault_balance, 1091);
}
