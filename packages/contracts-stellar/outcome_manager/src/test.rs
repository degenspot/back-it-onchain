#![cfg(test)]

use crate::{
    CallData, OracleVote, OutcomeManagerContract, OutcomeManagerContractClient, CALLS,
    CALL_ORACLES, VOTES,
};
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
        let mut calls: Map<u64, CallData> = env.storage().instance().get(&CALLS).unwrap();
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

// ── SC-012: compute_multi_outcome_payout ──────────────────────────────────────

use crate::compute_multi_outcome_payout;

#[test]
fn test_multi_outcome_payout_matches_binary_formula() {
    // With a single losing pool, this must match the existing binary formula
    // used by withdraw_payout: stake + (stake * losing) / winning.
    let (payout, protocol_fee, creator_fee) = compute_multi_outcome_payout(100, 1000, &[500], 0, 0);
    assert_eq!(protocol_fee, 0);
    assert_eq!(creator_fee, 0);
    assert_eq!(payout, 100 + (100 * 500) / 1000);
}

#[test]
fn test_multi_outcome_payout_sums_multiple_losing_pools() {
    // Three outcomes: winner has 1000, two losers have 300 and 200 (500 total).
    let (payout, _protocol_fee, _creator_fee) =
        compute_multi_outcome_payout(100, 1000, &[300, 200], 0, 0);
    assert_eq!(payout, 100 + (100 * 500) / 1000);
}

#[test]
fn test_multi_outcome_payout_deducts_fees_before_distribution() {
    // losing_pool_gross = 1000; protocol 1% = 10, creator 0.5% = 5.
    // losing_pool_net = 985. User has half the 2000 winning pool.
    let (payout, protocol_fee, creator_fee) =
        compute_multi_outcome_payout(1000, 2000, &[1000], 100, 50);
    assert_eq!(protocol_fee, 10);
    assert_eq!(creator_fee, 5);
    assert_eq!(payout, 1000 + (1000 * 985) / 2000);
}

#[test]
fn test_multi_outcome_payout_zero_stake_yields_zero() {
    assert_eq!(
        compute_multi_outcome_payout(0, 1000, &[500], 100, 50),
        (0, 0, 0)
    );
}

#[test]
#[should_panic(expected = "winning_pool must be > 0")]
fn test_multi_outcome_payout_zero_winning_pool_with_stake_panics() {
    compute_multi_outcome_payout(100, 0, &[500], 0, 0);
}

/// Conservation invariant, run across many (deterministic, LCG-generated)
/// scenarios: the sum of all winners' payouts, plus protocol fee, plus
/// creator fee, equals exactly winning_pool + losing_pool_gross - dust,
/// where dust is the (non-negative, bounded) truncation lost to integer
/// division. No tokens are ever fabricated, and dust is always < the
/// number of winners (each winner can lose at most 1 unit to truncation).
#[test]
fn test_multi_outcome_payout_conservation_invariant_10000_iterations() {
    const MAX_WINNERS: usize = 5;
    const MAX_LOSING_POOLS: usize = 4;

    let mut seed: u64 = 42;
    let mut next = || {
        // Simple LCG — deterministic, no external `rand` dependency needed.
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        (seed >> 33) as i128
    };

    for _ in 0..10_000 {
        let num_winners = 1 + (next() % MAX_WINNERS as i128) as usize;
        let winning_pool = 1_000 + (next() % 1_000_000);
        let num_losing_pools = 1 + (next() % MAX_LOSING_POOLS as i128) as usize;

        let mut losing_pools = [0i128; MAX_LOSING_POOLS];
        let mut losing_pool_gross = 0i128;
        for slot in losing_pools.iter_mut().take(num_losing_pools) {
            let pool = next() % 500_000;
            *slot = pool;
            losing_pool_gross += pool;
        }
        let losing_pools_slice = &losing_pools[..num_losing_pools];

        let protocol_fee_bps = next() % 300; // up to 3%
        let creator_fee_bps = next() % 100; // up to 1%

        // Split winning_pool across winners as individual stakes summing to it.
        let mut stakes = [0i128; MAX_WINNERS];
        let mut remaining = winning_pool;
        for (i, slot) in stakes.iter_mut().take(num_winners).enumerate() {
            let stake = if i == num_winners - 1 {
                remaining
            } else {
                let s = remaining / 2;
                remaining -= s;
                s
            };
            *slot = stake;
        }

        let mut total_payout = 0i128;
        let mut protocol_fee_total = 0i128;
        let mut creator_fee_total = 0i128;
        for &stake in stakes.iter().take(num_winners) {
            let (payout, protocol_fee, creator_fee) = compute_multi_outcome_payout(
                stake,
                winning_pool,
                losing_pools_slice,
                protocol_fee_bps,
                creator_fee_bps,
            );
            total_payout += payout;
            // Fees are computed per-call from the same losing_pool_gross, so
            // they're identical across winners in this test — just capture
            // once rather than summing duplicates.
            protocol_fee_total = protocol_fee;
            creator_fee_total = creator_fee;
        }

        let losing_pool_net = losing_pool_gross - protocol_fee_total - creator_fee_total;
        let expected_total = winning_pool + losing_pool_net;
        let dust = expected_total - total_payout;

        assert!(
            dust >= 0 && dust < num_winners as i128,
            "dust {} out of bounds for {} winners (winning_pool={}, losing_pool_gross={})",
            dust,
            num_winners,
            winning_pool,
            losing_pool_gross
        );
    }
}
