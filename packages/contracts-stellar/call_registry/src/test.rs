#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    vec, Address, BytesN, Env, IntoVal, String, Symbol, TryFromVal, Val,
};

fn default_metadata(env: &Env) -> CreateCallMetadata {
    CreateCallMetadata {
        token_address: Address::generate(env),
        pair_id: BytesN::from_array(env, &[0; 32]),
        ipfs_cid: String::from_str(env, "QmHash"),
        num_outcomes: 2, // binary market
    }
}

// â”€â”€ Existing tests (preserved) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    // #314 â€” create_call must reject a call that isn't authorized by the
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

    // No auth mocked for `creator` at all â€” create_call must panic on
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
#[should_panic(expected = "ContractPaused")]
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

// â”€â”€ Issue #161: Dynamic surge fee â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_surge_fee_basis_points() {
    // 0 participants â†’ 50 bp
    assert_eq!(compute_fee_basis_points(0), 50);
    // 10 participants â†’ 55 bp
    assert_eq!(compute_fee_basis_points(10), 55);
    // 100 participants â†’ 100 bp
    assert_eq!(compute_fee_basis_points(100), 100);
    // 300 participants â†’ capped at 200 bp
    assert_eq!(compute_fee_basis_points(300), 200);
    // 1000 participants â†’ still capped at 200 bp
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

    // participant_count = 1 â†’ fee_bps = 50; stake 10_000 â†’ fee = 50, net = 9_950
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

    // 1 participant â†’ 50 bp
    assert_eq!(client.get_fee_basis_points(&call_id), 50);
}

// â”€â”€ Issue #160: distribute_dividends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    let holder_c = Address::generate(&env);

    // Distribute to 3 recipients (SC-016): weights 3, 2, 1 → total 6
    // holder_a: 50*3/6=25, holder_b: 50*2/6=16, holder_c: 50*1/6=8 → dust 1
    let to = vec![&env, holder_a.clone(), holder_b.clone(), holder_c.clone()];
    let weights = vec![&env, 3i128, 2i128, 1i128];
    let treasury = Address::generate(&env);
    client.update_fee_config(&100u32, &treasury);
    client.distribute_dividends(&stake_token, &to, &weights);

    assert_eq!(stake_token_client.balance(&holder_a), 25);
    assert_eq!(stake_token_client.balance(&holder_b), 16);
    assert_eq!(stake_token_client.balance(&holder_c), 8);
    assert_eq!(stake_token_client.balance(&treasury), 1);
    assert_eq!(client.get_platform_fees(), 0);
}

#[test]
#[should_panic(expected = "NoFeesToDistribute")]
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
    let to = vec![&env, holder.clone()];
    let weights = vec![&env, 1i128];
    client.distribute_dividends(&stake_token, &to, &weights);
}

// â”€â”€ Issue #170: Decentralized Token Whitelisting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // Two vouches â€” not yet whitelisted
    client.vouch_for_token(&staker1, &token);
    assert!(!client.is_token_whitelisted(&token));
    client.vouch_for_token(&staker2, &token);
    assert!(!client.is_token_whitelisted(&token));

    // Third vouch â†’ auto-whitelisted
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

    // Same staker vouches twice â€” only one counted
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

    // No whitelist call â€” should panic
    client.create_call(
        &creator,
        &stake_token,
        &100,
        &(env.ledger().timestamp() + 1000),
        &default_metadata(&env),
    );
}

// â”€â”€ Issue #169: Storage TTL & Archival â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    client.set_outcome_manager(&creator);
    client.finalize_call(&call_id, &0u32, &1000i128, &false, &creator);

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

// â”€â”€ Early Exit (Hedging / Position Closing) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // rando has no stake â€” should panic
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
    client.set_outcome_manager(&creator);
    client.finalize_call(&call_id, &0u32, &1000i128, &false, &creator);

    // Try to exit early â€” should panic
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
#[should_panic(expected = "ContractPaused")]
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

// â”€â”€ Multi-Outcome Markets (Scalar/Categorical) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    client.set_outcome_manager(&creator);
    client.finalize_call(&call_id, &1u32, &2000i128, &false, &creator);

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
    client.set_outcome_manager(&creator);
    client.finalize_call(&call_id, &1u32, &2000i128, &false, &creator);

    // staker_a withdraws â€” should get their stake + proportional share of losing pools
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
    // outcome 0 = 100, outcome 2 = 498, outcome 3 = 0 â†’ total other = 598
    // outcome 0 gets: 100 + 199 * 100 / 598 = 100 + 33 = 133
    // outcome 2 gets: 498 + 199 * 498 / 598 = 498 + 165 = 663
    // outcome 3 gets: 0 (no existing stake, no share)
    assert_eq!(call.outcome_pools.get(0).unwrap(), 133);
    assert_eq!(call.outcome_pools.get(2).unwrap(), 663);
    assert_eq!(call.outcome_pools.get(3).unwrap(), 0);
}

// â”€â”€ Issue #315 (SC-002): Binary Market Backward Compatibility Shims â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_binary_pools() {
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
    // Creator stakes 100 on YES (outcome 0).
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // Staker backs NO (outcome 1): 1000 gross â†’ 995 net after 50 bp surge fee.
    client.stake_on_call(&call_id, &staker, &1000, &1u32);

    let (yes, no) = client.get_binary_pools(&call_id);
    assert_eq!(yes, 100);
    assert_eq!(no, 995);
}

#[test]
#[should_panic(expected = "Pools length must be 2 for binary market")]
fn test_get_binary_pools_non_binary_panics() {
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
    // 3-outcome market is NOT binary â†’ get_binary_pools must panic.
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &multi_metadata(&env, 3),
    );

    client.get_binary_pools(&call_id);
}

// â”€â”€ Issue #316 (SC-003): SAC Escrow with Balance-Delta Guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Mock fee-on-transfer token: the receiver's balance grows by only 90% of the
// transferred `amount` (10% fee kept by the token), so CallRegistry's balance-
// delta escrow sees `net < amount`.
mod fee_token {
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

    /// 10% fee on every transfer.
    const FEE_BPS: i128 = 1000;

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum DataKey {
        Balance(Address),
    }

    #[contract]
    pub struct FeeToken;

    #[contractimpl]
    impl FeeToken {
        pub fn balance(env: Env, id: Address) -> i128 {
            env.storage()
                .instance()
                .get(&DataKey::Balance(id))
                .unwrap_or(0)
        }

        pub fn mint(env: Env, to: Address, amount: i128) {
            let current: i128 = env
                .storage()
                .instance()
                .get(&DataKey::Balance(to.clone()))
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::Balance(to.clone()), &(current + amount));
        }

        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            from.require_auth();
            let from_balance: i128 = env
                .storage()
                .instance()
                .get(&DataKey::Balance(from.clone()))
                .unwrap_or(0);
            if from_balance < amount {
                panic!("insufficient balance");
            }
            env.storage()
                .instance()
                .set(&DataKey::Balance(from.clone()), &(from_balance - amount));

            // Fee-on-transfer: only 90% of `amount` lands in `to`'s balance.
            let fee = amount * FEE_BPS / 10_000;
            let net = amount - fee;
            let to_balance: i128 = env
                .storage()
                .instance()
                .get(&DataKey::Balance(to.clone()))
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::Balance(to.clone()), &(to_balance + net));
        }

        pub fn approve(
            _env: Env,
            _from: Address,
            _spender: Address,
            _amount: i128,
            _expiration_ledger: u32,
        ) {
            // Not exercised by the balance-delta tests (no vault configured).
        }
    }
}

#[test]
fn test_fee_on_transfer_tokens() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Register the 10%-fee-on-transfer token and whitelist it.
    let stake_token = env.register_contract(None, fee_token::FeeToken);
    let fee_token_client = fee_token::FeeTokenClient::new(&env, &stake_token);
    client.whitelist_token_admin(&stake_token);

    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    fee_token_client.mint(&creator, &1000);
    fee_token_client.mint(&staker, &1000);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &end_ts,
        &default_metadata(&env),
    );

    // Contract received 90 (not 100): 10% token fee taken on transfer.
    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 90);
    assert_eq!(call.vault_balance, 90);
    assert_eq!(client.get_user_stake(&call_id, &creator, &0u32), 90);
    assert_eq!(fee_token_client.balance(&contract_id), 90);

    // CallCreated event carries (gross, net).
    let events = env.events().all();
    let last_event = events.last().unwrap();
    let created_data: Vec<Val> = last_event.2.into_val(&env);
    let gross: i128 = created_data.get(1).unwrap().into_val(&env);
    let net: i128 = created_data.get(2).unwrap().into_val(&env);
    assert_eq!(gross, 100);
    assert_eq!(net, 90);

    // Stake 1000 on NO: contract receives 900, 50 bp surge fee on 900 = 4, net 896.
    client.stake_on_call(&call_id, &staker, &1000, &1u32);

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 896);
    assert_eq!(call.vault_balance, 986); // 90 + 896
    assert_eq!(call.participant_count, 2);
    assert_eq!(client.get_user_stake(&call_id, &staker, &1u32), 896);
    assert_eq!(client.get_platform_fees(), 4);

    // Contract physically holds 90 + 900 = 990 (= 986 vault + 4 fees).
    assert_eq!(fee_token_client.balance(&contract_id), 990);

    // StakeAdded event carries (outcome_index, gross, net, fee, fee_bps, ...).
    let events = env.events().all();
    let last_event = events.last().unwrap();
    let symbol: Symbol = last_event.1.get(0).unwrap().into_val(&env);
    assert_eq!(symbol, Symbol::new(&env, "StakeAdded"));
    let stake_data: Vec<Val> = last_event.2.into_val(&env);
    let gross: i128 = stake_data.get(1).unwrap().into_val(&env);
    let net: i128 = stake_data.get(2).unwrap().into_val(&env);
    let fee: i128 = stake_data.get(3).unwrap().into_val(&env);
    let fee_bps: i128 = stake_data.get(4).unwrap().into_val(&env);
    assert_eq!(gross, 1000);
    assert_eq!(net, 896);
    assert_eq!(fee, 4);
    assert_eq!(fee_bps, 50);
}

#[test]
#[should_panic(expected = "Amount must be greater than zero")]
fn test_zero_amount_stake_panics() {
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

    // Staking 0 must be rejected before any transfer happens.
    client.stake_on_call(&call_id, &staker, &0, &1u32);
}

// ── SC-015: double withdraw reverts & fee accumulates ───────────────────────

#[test]
#[should_panic(expected = "AlreadyWithdrawn")]
fn test_withdraw_payout_double_claim() {
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
        &multi_metadata(&env, 2),
    );
    client.stake_on_call(&call_id, &staker_a, &1000, &0u32);
    client.stake_on_call(&call_id, &staker_b, &500, &1u32);

    env.ledger().set_timestamp(end_ts + 1);
    client.set_outcome_manager(&creator);
    client.finalize_call(&call_id, &0u32, &2000i128, &false, &creator);

    client.withdraw_payout(&call_id, &staker_a, &0u32);
    // Second withdraw must revert
    client.withdraw_payout(&call_id, &staker_a, &0u32);
}

#[test]
fn test_withdraw_payout_fee_accumulates() {
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
        &multi_metadata(&env, 2),
    );
    // fees from stake: ~50bp each
    client.stake_on_call(&call_id, &staker_a, &1000, &0u32);
    client.stake_on_call(&call_id, &staker_b, &1000, &1u32);
    let fees_after_stake = client.get_platform_fees();
    assert!(fees_after_stake > 0);

    env.ledger().set_timestamp(end_ts + 1);
    client.set_outcome_manager(&creator);
    client.finalize_call(&call_id, &0u32, &2000i128, &false, &creator);

    client.withdraw_payout(&call_id, &staker_a, &0u32);
    let fees_after_withdraw = client.get_platform_fees();
    // Fee from share_of_losers should have been added
    assert!(fees_after_withdraw > fees_after_stake);
}

// ── SC-017: FeeConfig update ────────────────────────────────────────────────

#[test]
fn test_update_fee_config_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let treasury = Address::generate(&env);
    client.update_fee_config(&100u32, &treasury);
    let cfg = client.get_fee_config();
    assert_eq!(cfg.bps, 100);
    assert_eq!(cfg.treasury, treasury);
}

#[test]
#[should_panic(expected = "InvalidFeeConfig")]
fn test_update_fee_config_bps_too_low() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let treasury = Address::generate(&env);
    client.update_fee_config(&49u32, &treasury);
}

#[test]
#[should_panic(expected = "InvalidFeeConfig")]
fn test_update_fee_config_bps_too_high() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let treasury = Address::generate(&env);
    client.update_fee_config(&201u32, &treasury);
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_distribute_dividends_non_admin() {
    let env = Env::default();
    // Do not mock all auths so non-admin fails
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Manually set some platform fees by using admin path is hard without mock;
    // instead just call and expect auth failure on admin.require_auth
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let holder = Address::generate(&env);
    let to = vec![&env, holder];
    let weights = vec![&env, 1i128];
    // Without mock_all_auths, require_auth on admin will fail
    client.distribute_dividends(&stake_token, &to, &weights);
}

// ── SC-088: Fee accrual to PlatformFees (accrue_fee hook) ────────────────────

/// Return the data payload of the most recent event whose first topic is the
/// symbol `name`, or `None` if no such event was emitted.
fn last_event_data(env: &Env, name: &str) -> Option<soroban_sdk::Vec<Val>> {
    let wanted = Symbol::new(env, name);
    let events = env.events().all();
    let mut found: Option<soroban_sdk::Vec<Val>> = None;
    for i in 0..events.len() {
        let ev = events.get(i).unwrap();
        if ev.1.is_empty() {
            continue;
        }
        let topic0 = ev.1.get(0).unwrap();
        if let Ok(sym) = Symbol::try_from_val(env, &topic0) {
            if sym == wanted {
                found = Some(ev.2.into_val(env));
            }
        }
    }
    found
}

/// Boilerplate: register the contract, initialize an admin, whitelist a token
/// and open a call seeded with `initial_stake` on outcome 0.
fn setup_call<'a>(
    env: &'a Env,
    initial_stake: i128,
) -> (Address, CallRegistryClient<'a>, Address, Address, u64) {
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin);

    let creator = Address::generate(env);
    let stake_token_admin = Address::generate(env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin);
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(env, &stake_token);
    stake_token_admin_client.mint(&creator, &1_000_000);
    client.whitelist_token_admin(&stake_token);

    let end_ts = env.ledger().timestamp() + 1000;
    let call_id = client.create_call(
        &creator,
        &stake_token,
        &initial_stake,
        &end_ts,
        &default_metadata(env),
    );

    (contract_id, client, creator, stake_token, call_id)
}

#[test]
fn test_accrue_fee_stake_1k_at_50bps_yields_5() {
    // SC-088 acceptance criterion: stake 1_000 at 50 bps → PlatformFees == 5.
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, _creator, stake_token, call_id) = setup_call(&env, 100);
    let staker = Address::generate(&env);
    token::StellarAssetClient::new(&env, &stake_token).mint(&staker, &10_000);

    assert_eq!(client.get_platform_fees(), 0);

    // participant_count == 1 → fee_bps == 50 → fee = 1_000 * 50 / 10_000 = 5.
    assert_eq!(client.get_fee_basis_points(&call_id), 50);
    client.stake_on_call(&call_id, &staker, &1_000, &1u32);

    assert_eq!(client.get_platform_fees(), 5);
    // Net stake reached the pool: 1_000 - 5 = 995.
    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 995);
}

#[test]
fn test_accrue_fee_emits_fee_accrued_event_with_totals() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, _creator, stake_token, call_id) = setup_call(&env, 100);
    let staker = Address::generate(&env);
    token::StellarAssetClient::new(&env, &stake_token).mint(&staker, &100_000);

    client.stake_on_call(&call_id, &staker, &1_000, &1u32);

    let data = last_event_data(&env, "FeeAccrued").expect("FeeAccrued not emitted");
    let accrued: i128 = data.get(0).unwrap().into_val(&env);
    let before: i128 = data.get(1).unwrap().into_val(&env);
    let after: i128 = data.get(2).unwrap().into_val(&env);
    assert_eq!(accrued, 5);
    assert_eq!(before, 0);
    assert_eq!(after, 5);

    // A second stake accrues on top of the existing balance (checked_add).
    let staker_two = Address::generate(&env);
    token::StellarAssetClient::new(&env, &stake_token).mint(&staker_two, &100_000);
    client.stake_on_call(&call_id, &staker_two, &2_000, &1u32);

    let data = last_event_data(&env, "FeeAccrued").expect("FeeAccrued not emitted");
    let accrued: i128 = data.get(0).unwrap().into_val(&env);
    let before: i128 = data.get(1).unwrap().into_val(&env);
    let after: i128 = data.get(2).unwrap().into_val(&env);
    assert_eq!(accrued, 10); // 2_000 * 50 / 10_000
    assert_eq!(before, 5);
    assert_eq!(after, 15);
    assert_eq!(client.get_platform_fees(), 15);
}

#[test]
fn test_accrue_fee_hook_callable_by_registry_itself() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, _creator, _stake_token, call_id) = setup_call(&env, 100);

    // caller == env.current_contract_address() → accrual succeeds.
    let total = client.accrue_fee(&contract_id, &call_id, &7i128);
    assert_eq!(total, 7);
    assert_eq!(client.get_platform_fees(), 7);

    let total = client.accrue_fee(&contract_id, &call_id, &13i128);
    assert_eq!(total, 20);
    assert_eq!(client.get_platform_fees(), 20);

    let data = last_event_data(&env, "FeeAccrued").expect("FeeAccrued not emitted");
    let accrued: i128 = data.get(0).unwrap().into_val(&env);
    let after: i128 = data.get(2).unwrap().into_val(&env);
    assert_eq!(accrued, 13);
    assert_eq!(after, 20);
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_accrue_fee_non_registry_caller_reverts() {
    // SC-088 acceptance criterion: a non-registry caller must revert, even with
    // its own auth mocked — the guard is the address check against
    // env.current_contract_address(), not just require_auth.
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, _creator, _stake_token, call_id) = setup_call(&env, 100);
    let rando = Address::generate(&env);

    client.accrue_fee(&rando, &call_id, &100i128);
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_accrue_fee_admin_is_not_the_registry() {
    // The contract admin is not the registry address either.
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    client.accrue_fee(&admin, &0u64, &100i128);
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn test_accrue_fee_rejects_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, _creator, _stake_token, call_id) = setup_call(&env, 100);
    client.accrue_fee(&contract_id, &call_id, &0i128);
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn test_accrue_fee_rejects_negative_amount() {
    // A negative accrual would silently drain PlatformFees.
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, _creator, _stake_token, call_id) = setup_call(&env, 100);
    client.accrue_fee(&contract_id, &call_id, &-1i128);
}

#[test]
#[should_panic(expected = "CallNotFound")]
fn test_accrue_fee_unknown_call_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, _creator, _stake_token, _call_id) = setup_call(&env, 100);
    client.accrue_fee(&contract_id, &9_999u64, &10i128);
}

#[test]
fn test_accrue_fee_on_exit_early() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, _creator, stake_token, call_id) = setup_call(&env, 100);
    let stake_token_client = token::Client::new(&env, &stake_token);
    let staker = Address::generate(&env);
    token::StellarAssetClient::new(&env, &stake_token).mint(&staker, &200_000);

    // Stake 100_000 at 50 bps → fee 500, net 99_500.
    client.stake_on_call(&call_id, &staker, &100_000, &1u32);
    assert_eq!(client.get_platform_fees(), 500);

    // Exit early on a stake of 99_500:
    //   refund  = 99_500 * 80 / 100 = 79_600
    //   penalty = 19_900
    //   fee     = 19_900 * 50 / 10_000 = 99   (participant_count == 2 → 50 bps)
    //   pool-bound remainder = 19_801
    let balance_before = stake_token_client.balance(&staker);
    client.exit_early(&call_id, &staker);
    let balance_after = stake_token_client.balance(&staker);
    assert_eq!(balance_after - balance_before, 79_600);

    // Exit fee accrued on top of the stake fee.
    assert_eq!(client.get_platform_fees(), 599);

    let data = last_event_data(&env, "FeeAccrued").expect("FeeAccrued not emitted");
    let accrued: i128 = data.get(0).unwrap().into_val(&env);
    let before: i128 = data.get(1).unwrap().into_val(&env);
    let after: i128 = data.get(2).unwrap().into_val(&env);
    assert_eq!(accrued, 99);
    assert_eq!(before, 500);
    assert_eq!(after, 599);

    // The exited pool is emptied; only the fee-net remainder is redistributed.
    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 0);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 100 + 19_801);
    assert_eq!(call.vault_balance, 19_901);

    // Contract balance = pool-bound funds + accrued fees, so the fees are
    // physically available for distribute_dividends.
    assert_eq!(stake_token_client.balance(&contract_id), 19_901 + 599);

    // EarlyExit still reports the accrual redundantly.
    let data = last_event_data(&env, "EarlyExit").expect("EarlyExit not emitted");
    let remaining: i128 = data.get(3).unwrap().into_val(&env);
    let fee: i128 = data.get(4).unwrap().into_val(&env);
    let fee_bps: i128 = data.get(5).unwrap().into_val(&env);
    let platform_fees_total: i128 = data.get(8).unwrap().into_val(&env);
    assert_eq!(remaining, 19_801);
    assert_eq!(fee, 99);
    assert_eq!(fee_bps, 50);
    assert_eq!(platform_fees_total, 599);
}

#[test]
fn test_accrue_fee_exit_early_below_rounding_threshold_accrues_nothing() {
    // A penalty smaller than 10_000 / bps rounds to zero: the staker is never
    // over-charged and PlatformFees is left untouched.
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, creator, _stake_token, call_id) = setup_call(&env, 100);

    // stake = 100 → penalty 20 → 20 * 50 / 10_000 == 0.
    client.exit_early(&call_id, &creator);

    assert_eq!(client.get_platform_fees(), 0);
    assert!(last_event_data(&env, "FeeAccrued").is_none());

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_pools.get(0).unwrap(), 0);
    assert_eq!(call.outcome_pools.get(1).unwrap(), 20);
    assert_eq!(call.vault_balance, 20);
}

#[test]
fn test_accrue_fee_accumulates_across_stake_and_hook() {
    // Fees accumulate monotonically across every accrual path and remain
    // available to distribute_dividends.
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, _creator, stake_token, call_id) = setup_call(&env, 100);
    let staker = Address::generate(&env);
    token::StellarAssetClient::new(&env, &stake_token).mint(&staker, &100_000);

    client.stake_on_call(&call_id, &staker, &10_000, &1u32); // fee 50
    assert_eq!(client.get_platform_fees(), 50);

    client.accrue_fee(&contract_id, &call_id, &25i128);
    assert_eq!(client.get_platform_fees(), 75);

    let holder = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.update_fee_config(&100u32, &treasury);
    client.distribute_dividends(
        &stake_token,
        &vec![&env, holder.clone()],
        &vec![&env, 1i128],
    );

    assert_eq!(token::Client::new(&env, &stake_token).balance(&holder), 75);
    assert_eq!(client.get_platform_fees(), 0);
}

// ── SC-090: registry owner getter (treasury ownership mirror source) ─────────

#[test]
fn test_get_owner_returns_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    assert_eq!(client.get_owner(), admin);
}

#[test]
#[should_panic(expected = "AdminNotSet")]
fn test_get_owner_before_initialize_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    client.get_owner();
}

// ── SC-011 Admin init & two-step handover ─────────────────────────────────────

#[test]
#[should_panic(expected = "AlreadyInitialized")]
fn test_initialize_twice_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
fn test_propose_and_accept_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.initialize(&admin);

    client.propose_admin(&new_admin);
    client.accept_admin();

    assert_eq!(client.get_admin_address(), new_admin);
}

#[test]
#[should_panic]
fn test_accept_admin_without_pending_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.accept_admin();
}

// ── SC-012 Pausable guard ─────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "ContractPaused")]
fn test_paused_blocks_create_call() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.pause();

    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    client.whitelist_token_admin(&stake_token);

    client.create_call(
        &creator,
        &stake_token,
        &100,
        &(env.ledger().timestamp() + 1000),
        &default_metadata(&env),
    );
}

#[test]
fn test_pause_unpause_events_and_resume() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    assert!(!client.get_is_paused());
    client.pause();
    assert!(client.get_is_paused());
    client.unpause();
    assert!(!client.get_is_paused());

    // After unpause, create_call works again
    let creator = Address::generate(&env);
    let stake_token_admin = Address::generate(&env);
    let stake_token_contract = env.register_stellar_asset_contract_v2(stake_token_admin.clone());
    let stake_token = stake_token_contract.address();
    let stake_token_admin_client = token::StellarAssetClient::new(&env, &stake_token);
    stake_token_admin_client.mint(&creator, &1000);
    client.whitelist_token_admin(&stake_token);

    let call_id = client.create_call(
        &creator,
        &stake_token,
        &100,
        &(env.ledger().timestamp() + 1000),
        &default_metadata(&env),
    );
    assert_eq!(call_id, 0);
}

// ── SC-013 TTL bump strategy ──────────────────────────────────────────────────

#[test]
fn test_maybe_bump_extends_when_below_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Reading admin bumps TTL; assert key still present (smoke).
    let _ = client.get_admin_address();
    let _ = client.get_is_paused();
}

// ── SC-014 Finalize via OutcomeManager only ───────────────────────────────────

#[test]
fn test_finalize_via_outcome_manager_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let om = Address::generate(&env);
    client.set_outcome_manager(&om);

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

    env.ledger().set_timestamp(end_ts + 1);
    client.finalize_call(&call_id, &0u32, &1000i128, &false, &om);

    let call = client.get_call(&call_id);
    assert!(call.settled);
    assert_eq!(call.winning_outcome, 0);
    assert_eq!(call.final_price, 1000);
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_finalize_direct_call_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let om = Address::generate(&env);
    client.set_outcome_manager(&om);

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

    env.ledger().set_timestamp(end_ts + 1);
    // Direct finalize by creator (not OM) must revert
    client.finalize_call(&call_id, &0u32, &1000i128, &false, &creator);
}

#[test]
#[should_panic(expected = "CallSettled")]
fn test_finalize_twice_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CallRegistry);
    let client = CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let om = Address::generate(&env);
    client.set_outcome_manager(&om);

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

    env.ledger().set_timestamp(end_ts + 1);
    client.finalize_call(&call_id, &0u32, &1000i128, &false, &om);
    client.finalize_call(&call_id, &0u32, &1000i128, &false, &om);
}
