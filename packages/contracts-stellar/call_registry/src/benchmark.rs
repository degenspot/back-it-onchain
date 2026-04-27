// Benchmark tests for stake_on_call resource consumption (Issue #232)
// Run with: cargo test benchmark --features testutils -- --nocapture

#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::BytesN;

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let staker = Address::generate(&env);

    // Initialize contract
    CallRegistry::initialize(env.clone(), admin.clone());

    (env, admin, creator, staker)
}

fn setup_call_with_token(env: &Env, creator: &Address, num_outcomes: u32) -> u64 {
    // Create a mock token address
    let token_address = Address::generate(env);

    // Whitelist the token
    CallRegistry::whitelist_token_admin(env.clone(), token_address.clone());

    // Create call metadata
    let metadata = CreateCallMetadata {
        token_address: token_address.clone(),
        pair_id: BytesN::from_array(env, &[0u8; 32]),
        ipfs_cid: String::from_str(env, "QmTest123"),
        num_outcomes,
    };

    // Create the call
    let call_id = CallRegistry::create_call(
        env.clone(),
        creator.clone(),
        token_address.clone(),
        1000, // initial stake
        env.ledger().timestamp() + 86400, // 24 hours from now
        metadata,
    );

    call_id
}

/// Benchmark: stake_on_call with binary market (2 outcomes)
#[test]
fn benchmark_stake_binary_market() {
    let (env, _admin, creator, staker) = create_test_env();
    let call_id = setup_call_with_token(&env, &creator, 2);

    // Measure resources for staking
    let budget = env.budget();
    budget.reset_unlimited();

    CallRegistry::stake_on_call(env.clone(), call_id, staker.clone(), 500, 1);

    // Print resource usage
    println!("=== Benchmark: Binary Market (2 outcomes) ===");
    println!(
        "Instructions consumed: {}",
        budget.get_cpu_insns_consumed()
    );
    println!(
        "Memory bytes consumed: {}",
        budget.get_mem_bytes_consumed()
    );
}

/// Benchmark: stake_on_call with categorical market (8 outcomes)
#[test]
fn benchmark_stake_categorical_market() {
    let (env, _admin, creator, staker) = create_test_env();
    let call_id = setup_call_with_token(&env, &creator, 8);

    let budget = env.budget();
    budget.reset_unlimited();

    CallRegistry::stake_on_call(env.clone(), call_id, staker.clone(), 500, 5);

    println!("=== Benchmark: Categorical Market (8 outcomes) ===");
    println!(
        "Instructions consumed: {}",
        budget.get_cpu_insns_consumed()
    );
    println!(
        "Memory bytes consumed: {}",
        budget.get_mem_bytes_consumed()
    );
}

/// Benchmark: stake_on_call with max outcomes (32)
#[test]
fn benchmark_stake_max_outcomes() {
    let (env, _admin, creator, staker) = create_test_env();
    let call_id = setup_call_with_token(&env, &creator, 32);

    let budget = env.budget();
    budget.reset_unlimited();

    CallRegistry::stake_on_call(env.clone(), call_id, staker.clone(), 500, 16);

    println!("=== Benchmark: Max Outcomes (32) ===");
    println!(
        "Instructions consumed: {}",
        budget.get_cpu_insns_consumed()
    );
    println!(
        "Memory bytes consumed: {}",
        budget.get_mem_bytes_consumed()
    );
}

/// Benchmark: stake_on_call with vault configured
#[test]
fn benchmark_stake_with_vault() {
    let (env, _admin, creator, staker) = create_test_env();
    let vault_address = Address::generate(&env);

    // Set vault contract
    CallRegistry::set_vault(env.clone(), vault_address);

    let call_id = setup_call_with_token(&env, &creator, 2);

    let budget = env.budget();
    budget.reset_unlimited();

    CallRegistry::stake_on_call(env.clone(), call_id, staker.clone(), 500, 0);

    println!("=== Benchmark: With Vault Integration ===");
    println!(
        "Instructions consumed: {}",
        budget.get_cpu_insns_consumed()
    );
    println!(
        "Memory bytes consumed: {}",
        budget.get_mem_bytes_consumed()
    );
}

/// Benchmark: multiple sequential stakes (measure scaling)
#[test]
fn benchmark_sequential_stakes() {
    let (env, _admin, creator, _staker) = create_test_env();
    let call_id = setup_call_with_token(&env, &creator, 2);

    println!("=== Benchmark: Sequential Stakes Scaling ===");

    for i in 1..=10 {
        let staker = Address::generate(&env);
        let budget = env.budget();
        budget.reset_unlimited();

        CallRegistry::stake_on_call(
            env.clone(),
            call_id,
            staker,
            100 * i as i128, // Increasing stake amounts
            i % 2,           // Alternate outcomes
        );

        let insns = budget.get_cpu_insns_consumed();
        println!("Stake #{}: {} instructions", i, insns);
    }
}

/// Comprehensive resource report
#[test]
fn benchmark_resource_report() {
    println!("\n========================================");
    println!("SOROBAN RESOURCE BENCHMARK REPORT");
    println!("========================================\n");

    // Test 1: Binary market
    {
        let (env, _admin, creator, staker) = create_test_env();
        let call_id = setup_call_with_token(&env, &creator, 2);

        let budget = env.budget();
        budget.reset_unlimited();

        CallRegistry::stake_on_call(env.clone(), call_id, staker, 500, 1);

        println!("Binary Market (2 outcomes):");
        println!(
            "  CPU Instructions: {}",
            budget.get_cpu_insns_consumed()
        );
        println!(
            "  Memory Bytes: {}",
            budget.get_mem_bytes_consumed()
        );
        println!();
    }

    // Test 2: Categorical market
    {
        let (env, _admin, creator, staker) = create_test_env();
        let call_id = setup_call_with_token(&env, &creator, 8);

        let budget = env.budget();
        budget.reset_unlimited();

        CallRegistry::stake_on_call(env.clone(), call_id, staker, 500, 5);

        println!("Categorical Market (8 outcomes):");
        println!(
            "  CPU Instructions: {}",
            budget.get_cpu_insns_consumed()
        );
        println!(
            "  Memory Bytes: {}",
            budget.get_mem_bytes_consumed()
        );
        println!();
    }

    // Test 3: Max outcomes
    {
        let (env, _admin, creator, staker) = create_test_env();
        let call_id = setup_call_with_token(&env, &creator, 32);

        let budget = env.budget();
        budget.reset_unlimited();

        CallRegistry::stake_on_call(env.clone(), call_id, staker, 500, 16);

        println!("Max Outcomes (32):");
        println!(
            "  CPU Instructions: {}",
            budget.get_cpu_insns_consumed()
        );
        println!(
            "  Memory Bytes: {}",
            budget.get_mem_bytes_consumed()
        );
        println!();
    }

    println!("========================================");
    println!("Benchmark complete!");
    println!("========================================");
}
