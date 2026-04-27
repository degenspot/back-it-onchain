use soroban_sdk::{Env, Address};
use crate::contract::StakingContractClient;

#[test]
#[should_panic(expected = "ReentrancyGuard: reentrant call detected")]
fn test_reentrancy_blocked() {
    let env = Env::default();
    let contract_id = env.register_contract(None, crate::contract::StakingContract);
    let client = StakingContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);

    // First call locks
    client.withdraw_payout(&user, &10);

    // Simulated second call before unlock (re-entry)
    client.withdraw_payout(&user, &5);
}