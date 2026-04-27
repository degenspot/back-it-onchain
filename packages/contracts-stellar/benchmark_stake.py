#!/usr/bin/env python3
"""
Gas/Resource Benchmarking Suite for stake_on_call (Issue #232)

This script measures the Soroban "Instructions" and "Read/Write Bytes" 
consumed by the stake_on_call function under various scenarios.

Usage:
    python benchmark_stake.py [--iterations N] [--output FILE]
"""

import subprocess
import json
import sys
import os
import argparse
from datetime import datetime
from typing import Dict, List, Any

# Configuration
CONTRACT_DIR = os.path.join(os.path.dirname(__file__), "..")
ITERATIONS_DEFAULT = 10


def run_cargo_test(test_name: str) -> Dict[str, Any]:
    """
    Run a specific benchmark test and parse the output.
    
    Returns a dictionary with metrics:
    - instructions: CPU instructions consumed
    - read_bytes: Bytes read from storage
    - write_bytes: Bytes written to storage
    - num_reads: Number of storage read operations
    - num_writes: Number of storage write operations
    """
    print(f"Running benchmark: {test_name}")
    
    cmd = [
        "cargo", "test",
        "--features", "testutils",
        "--",
        test_name,
        "--nocapture"
    ]
    
    try:
        result = subprocess.run(
            cmd,
            cwd=CONTRACT_DIR,
            capture_output=True,
            text=True,
            timeout=120
        )
        
        # Parse metrics from test output
        metrics = {
            "test_name": test_name,
            "instructions": 0,
            "read_bytes": 0,
            "write_bytes": 0,
            "num_reads": 0,
            "num_writes": 0,
            "success": result.returncode == 0
        }
        
        # Extract metrics from stdout/stderr
        output = result.stdout + result.stderr
        
        # Look for Soroban resource metering output
        for line in output.split('\n'):
            if 'instructions' in line.lower():
                try:
                    # Parse instruction count
                    parts = line.split(':')
                    if len(parts) >= 2:
                        metrics['instructions'] = int(parts[-1].strip())
                except:
                    pass
            
            if 'read_bytes' in line.lower():
                try:
                    parts = line.split(':')
                    if len(parts) >= 2:
                        metrics['read_bytes'] = int(parts[-1].strip())
                except:
                    pass
            
            if 'write_bytes' in line.lower():
                try:
                    parts = line.split(':')
                    if len(parts) >= 2:
                        metrics['write_bytes'] = int(parts[-1].strip())
                except:
                    pass
        
        return metrics
        
    except subprocess.TimeoutExpired:
        print(f"  ⚠ Timeout after 120s")
        return {"test_name": test_name, "success": False, "error": "timeout"}
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return {"test_name": test_name, "success": False, "error": str(e)}


def create_benchmark_test():
    """
    Create a comprehensive benchmark test file for stake_on_call.
    This test will be added to the call_registry test suite.
    """
    benchmark_code = '''// Benchmark tests for stake_on_call resource consumption (Issue #232)
#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger, Events};
use soroban_sdk::token;

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

fn setup_call_with_token(env: &Env, creator: &Address, num_outcomes: u32) -> (Address, u64) {
    // Create a mock token contract
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
    
    (token_address, call_id)
}

/// Benchmark: stake_on_call with binary market (2 outcomes)
#[test]
fn benchmark_stake_binary_market() {
    let (env, _admin, creator, staker) = create_test_env();
    let (token, call_id) = setup_call_with_token(&env, &creator, 2);
    
    // Measure resources for staking
    let budget = env.budget();
    budget.reset_unlimited();
    
    CallRegistry::stake_on_call(
        env.clone(),
        call_id,
        staker.clone(),
        500, // stake amount
        1,   // outcome index (NO)
    );
    
    // Print resource usage
    println!("=== Benchmark: Binary Market (2 outcomes) ===");
    println!("Instructions consumed: {:?}", budget.get_cpu_insns_consumed());
    println!("Memory bytes consumed: {:?}", budget.get_mem_bytes_consumed());
}

/// Benchmark: stake_on_call with categorical market (8 outcomes)
#[test]
fn benchmark_stake_categorical_market() {
    let (env, _admin, creator, staker) = create_test_env();
    let (token, call_id) = setup_call_with_token(&env, &creator, 8);
    
    let budget = env.budget();
    budget.reset_unlimited();
    
    CallRegistry::stake_on_call(
        env.clone(),
        call_id,
        staker.clone(),
        500,
        5, // outcome index
    );
    
    println!("=== Benchmark: Categorical Market (8 outcomes) ===");
    println!("Instructions consumed: {:?}", budget.get_cpu_insns_consumed());
    println!("Memory bytes consumed: {:?}", budget.get_mem_bytes_consumed());
}

/// Benchmark: stake_on_call with max outcomes (32)
#[test]
fn benchmark_stake_max_outcomes() {
    let (env, _admin, creator, staker) = create_test_env();
    let (token, call_id) = setup_call_with_token(&env, &creator, 32);
    
    let budget = env.budget();
    budget.reset_unlimited();
    
    CallRegistry::stake_on_call(
        env.clone(),
        call_id,
        staker.clone(),
        500,
        16, // outcome index
    );
    
    println!("=== Benchmark: Max Outcomes (32) ===");
    println!("Instructions consumed: {:?}", budget.get_cpu_insns_consumed());
    println!("Memory bytes consumed: {:?}", budget.get_mem_bytes_consumed());
}

/// Benchmark: stake_on_call with vault configured
#[test]
fn benchmark_stake_with_vault() {
    let (env, _admin, creator, staker) = create_test_env();
    let vault_address = Address::generate(&env);
    
    // Set vault contract
    CallRegistry::set_vault(env.clone(), vault_address);
    
    let (token, call_id) = setup_call_with_token(&env, &creator, 2);
    
    let budget = env.budget();
    budget.reset_unlimited();
    
    CallRegistry::stake_on_call(
        env.clone(),
        call_id,
        staker.clone(),
        500,
        0, // outcome index (YES)
    );
    
    println!("=== Benchmark: With Vault Integration ===");
    println!("Instructions consumed: {:?}", budget.get_cpu_insns_consumed());
    println!("Memory bytes consumed: {:?}", budget.get_mem_bytes_consumed());
}

/// Benchmark: multiple sequential stakes (measure scaling)
#[test]
fn benchmark_sequential_stakes() {
    let (env, _admin, creator, _staker) = create_test_env();
    let (token, call_id) = setup_call_with_token(&env, &creator, 2);
    
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
    println!("\\n========================================");
    println!("SOROBAN RESOURCE BENCHMARK REPORT");
    println!("========================================\\n");
    
    // Test 1: Binary market
    {
        let (env, _admin, creator, staker) = create_test_env();
        let (token, call_id) = setup_call_with_token(&env, &creator, 2);
        
        let budget = env.budget();
        budget.reset_unlimited();
        
        CallRegistry::stake_on_call(env.clone(), call_id, staker, 500, 1);
        
        println!("Binary Market (2 outcomes):");
        println!("  CPU Instructions: {}", budget.get_cpu_insns_consumed());
        println!("  Memory Bytes: {}", budget.get_mem_bytes_consumed());
        println!();
    }
    
    // Test 2: Categorical market
    {
        let (env, _admin, creator, staker) = create_test_env();
        let (token, call_id) = setup_call_with_token(&env, &creator, 8);
        
        let budget = env.budget();
        budget.reset_unlimited();
        
        CallRegistry::stake_on_call(env.clone(), call_id, staker, 500, 5);
        
        println!("Categorical Market (8 outcomes):");
        println!("  CPU Instructions: {}", budget.get_cpu_insns_consumed());
        println!("  Memory Bytes: {}", budget.get_mem_bytes_consumed());
        println!();
    }
    
    // Test 3: Max outcomes
    {
        let (env, _admin, creator, staker) = create_test_env();
        let (token, call_id) = setup_call_with_token(&env, &creator, 32);
        
        let budget = env.budget();
        budget.reset_unlimited();
        
        CallRegistry::stake_on_call(env.clone(), call_id, staker, 500, 16);
        
        println!("Max Outcomes (32):");
        println!("  CPU Instructions: {}", budget.get_cpu_insns_consumed());
        println!("  Memory Bytes: {}", budget.get_mem_bytes_consumed());
        println!();
    }
    
    println!("========================================");
    println!("Benchmark complete!");
    println!("========================================");
}
'''
    
    return benchmark_code


def main():
    parser = argparse.ArgumentParser(description='Benchmark stake_on_call resource consumption')
    parser.add_argument('--iterations', type=int, default=ITERATIONS_DEFAULT,
                       help='Number of iterations per test (default: 10)')
    parser.add_argument('--output', type=str, default='benchmark_results.json',
                       help='Output file for results (default: benchmark_results.json)')
    parser.add_argument('--generate-test', action='store_true',
                       help='Generate the benchmark test file')
    args = parser.parse_args()
    
    if args.generate_test:
        # Generate the benchmark test file
        test_file_path = os.path.join(CONTRACT_DIR, "call_registry", "src", "benchmark.rs")
        with open(test_file_path, 'w') as f:
            f.write(create_benchmark_test())
        
        print(f"✓ Benchmark test file created: {test_file_path}")
        print("\nTo run the benchmarks:")
        print(f"  cd {CONTRACT_DIR}/call_registry")
        print("  cargo test benchmark_resource_report --features testutils -- --nocapture")
        return
    
    # Run benchmarks
    print("Starting Gas/Resource Benchmarking Suite")
    print(f"Iterations per test: {args.iterations}")
    print("=" * 60)
    
    test_names = [
        "benchmark_stake_binary_market",
        "benchmark_stake_categorical_market",
        "benchmark_stake_max_outcomes",
        "benchmark_stake_with_vault",
        "benchmark_sequential_stakes",
        "benchmark_resource_report",
    ]
    
    all_results = []
    
    for test_name in test_names:
        results = []
        for i in range(args.iterations):
            result = run_cargo_test(test_name)
            results.append(result)
        
        # Aggregate results
        successful = [r for r in results if r.get('success', False)]
        if successful:
            avg_instructions = sum(r.get('instructions', 0) for r in successful) / len(successful)
            avg_read_bytes = sum(r.get('read_bytes', 0) for r in successful) / len(successful)
            avg_write_bytes = sum(r.get('write_bytes', 0) for r in successful) / len(successful)
            
            aggregated = {
                "test_name": test_name,
                "iterations": len(successful),
                "avg_instructions": avg_instructions,
                "avg_read_bytes": avg_read_bytes,
                "avg_write_bytes": avg_write_bytes,
                "success_rate": len(successful) / len(results)
            }
            all_results.append(aggregated)
            print(f"  ✓ {test_name}: avg {avg_instructions:.0f} instructions")
        else:
            print(f"  ✗ {test_name}: all iterations failed")
    
    # Save results
    output_data = {
        "timestamp": datetime.now().isoformat(),
        "iterations_per_test": args.iterations,
        "results": all_results
    }
    
    with open(args.output, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"\n✓ Results saved to {args.output}")
    
    # Print summary
    print("\n" + "=" * 60)
    print("BENCHMARK SUMMARY")
    print("=" * 60)
    for result in all_results:
        print(f"{result['test_name']}:")
        print(f"  Avg Instructions: {result['avg_instructions']:.0f}")
        print(f"  Avg Read Bytes: {result['avg_read_bytes']:.0f}")
        print(f"  Avg Write Bytes: {result['avg_write_bytes']:.0f}")
        print()


if __name__ == "__main__":
    main()
