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
    }
}

// ── Existing tests (preserved) ────────────────────────────────────────────────

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
    assert_eq!(call.total_stake_yes, 100);
    assert_eq!(call.total_stake_no, 0);
    assert_eq!(call.participant_count, 1);

    let stake = client.get_user_stake(&call_id, &creator, &true);
    assert_eq!(stake, 100);

    assert_eq!(stake_token_client.balance(&creator), 900);
    assert_eq!(stake_token_client.balance(&contract_id), 100);

    let events = env.events().all();
    let last_event = events.last().unwrap();
    let symbol: Symbol = last_event.1.get(0).unwrap().into_val(&env);
    assert_eq!(symbol, Symbol::new(&env, "CallCreated"));
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

    client.stake_on_call(&call_id, &staker, &1000, &false);

    let call = client.get_call(&call_id);
    assert_eq!(call.total_stake_yes, 100);
    // 50 bp fee on 1000 = 5; net = 995
    assert_eq!(call.total_stake_no, 995);
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
    client.stake_on_call(&call_id, &staker, &50, &false);
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

    client.stake_on_call(&call_id, &staker, &50, &false);
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

// ── Issue #161: Dynamic surge fee ────────────────────────────────────────────

#[test]
fn test_surge_fee_basis_points() {
    // 0 participants → 50 bp
    assert_eq!(compute_fee_basis_points(0), 50);
    // 10 participants → 55 bp
    assert_eq!(compute_fee_basis_points(10), 55);
    // 100 participants → 100 bp
    assert_eq!(compute_fee_basis_points(100), 100);
    // 300 participants → capped at 200 bp
    assert_eq!(compute_fee_basis_points(300), 200);
    // 1000 participants → still capped at 200 bp
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

    // participant_count = 1 → fee_bps = 50; stake 10_000 → fee = 50, net = 9_950
    client.stake_on_call(&call_id, &staker, &10_000, &false);

    let call = client.get_call(&call_id);
    assert_eq!(call.total_stake_no, 9_950);
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

    // 1 participant → 50 bp
    assert_eq!(client.get_fee_basis_points(&call_id), 50);
}

// ── Issue #160: distribute_dividends ─────────────────────────────────────────

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
    client.stake_on_call(&call_id, &staker, &10_000, &false);
    assert_eq!(client.get_platform_fees(), 50);

    let holder_a = Address::generate(&env);
    let holder_b = Address::generate(&env);

    // Distribute: holder_a has weight 3, holder_b has weight 2 → total 5
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

// ── Issue #170: Decentralized Token Whitelisting ──────────────────────────────

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

    // Two vouches — not yet whitelisted
    client.vouch_for_token(&staker1, &token);
    assert!(!client.is_token_whitelisted(&token));
    client.vouch_for_token(&staker2, &token);
    assert!(!client.is_token_whitelisted(&token));

    // Third vouch → auto-whitelisted
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

    // Same staker vouches twice — only one counted
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

    // No whitelist call — should panic
    client.create_call(
        &creator,
        &stake_token,
        &100,
        &(env.ledger().timestamp() + 1000),
        &default_metadata(&env),
    );
}

// ── Issue #169: Storage TTL & Archival ───────────────────────────────────────

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
    client.finalize_call(&call_id, &true, &1000i128, &creator);

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

// ── Early Exit (Hedging / Position Closing) ────────────────────────────────────

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

    // Call totals: YES = 0 (full stake removed), NO = 20 (penalty added)
    let call = client.get_call(&call_id);
    assert_eq!(call.total_stake_yes, 0);
    assert_eq!(call.total_stake_no, 20);
    assert_eq!(call.vault_balance, 20);

    // User stake should be removed
    assert_eq!(client.get_user_stake(&call_id, &creator, &true), 0);
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

    // Staker stakes 1000 on NO side (net after 50bp fee = 995)
    client.stake_on_call(&call_id, &staker, &1000, &false);

    // Staker exits early from NO position: stake = 995
    // Refund = 995 * 80 / 100 = 796
    // Remaining = 995 - 796 = 199 (goes to YES side)
    let staker_balance_before = stake_token_client.balance(&staker);
    client.exit_early(&call_id, &staker);
    let staker_balance_after = stake_token_client.balance(&staker);

    assert_eq!(staker_balance_after - staker_balance_before, 796);

    // Call totals: YES = 100 + 199 (penalty), NO = 0 (full stake removed)
    let call = client.get_call(&call_id);
    assert_eq!(call.total_stake_yes, 299); // 100 original + 199 penalty
    assert_eq!(call.total_stake_no, 0);

    // User stake should be removed
    assert_eq!(client.get_user_stake(&call_id, &staker, &false), 0);
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

    // rando has no stake — should panic
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
    client.finalize_call(&call_id, &true, &1000i128, &creator);

    // Try to exit early — should panic
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

    // staker_yes stakes 200 on YES (net after 50bp fee with participant_count=1: 200 - 1 = 199)
    client.stake_on_call(&call_id, &staker_yes, &200, &true);

    // staker_no stakes 500 on NO (net after 50bp fee with participant_count=2: 500 - 2 = 498)
    client.stake_on_call(&call_id, &staker_no, &500, &false);

    // Verify initial state
    let call = client.get_call(&call_id);
    // YES: 100 (creator) + 199 (staker_yes net) = 299
    assert_eq!(call.total_stake_yes, 299);
    // NO: 498 (staker_no net)
    assert_eq!(call.total_stake_no, 498);

    // staker_no exits early from NO position: stake = 498
    // Refund = 498 * 80 / 100 = 398
    // Remaining = 498 - 398 = 100 (goes to YES side)
    let staker_no_balance_before = stake_token_client.balance(&staker_no);
    client.exit_early(&call_id, &staker_no);
    let staker_no_balance_after = stake_token_client.balance(&staker_no);
    assert_eq!(staker_no_balance_after - staker_no_balance_before, 398);

    // After exit: YES = 299 + 100 (penalty from NO) = 399, NO = 0
    let call = client.get_call(&call_id);
    assert_eq!(call.total_stake_yes, 399);
    assert_eq!(call.total_stake_no, 0);

    // Creator and staker_yes still have their stakes
    assert_eq!(client.get_user_stake(&call_id, &creator, &true), 100);
    assert_eq!(client.get_user_stake(&call_id, &staker_yes, &true), 199);
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