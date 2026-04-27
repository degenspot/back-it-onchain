use proptest::prelude::*;
use soroban_sdk::{Env, Address};

use crate::contract::StakingContractClient;

#[derive(Debug, Clone)]
enum Action {
    Stake { user: u8, amount: i128 },
}

fn action_strategy() -> impl Strategy<Value = Action> {
    (0u8..10, 1i128..1_000_000).prop_map(|(user, amount)| {
        Action::Stake { user, amount }
    })
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10_000,
        .. ProptestConfig::default()
    })]

    #[test]
    fn invariant_total_pool_never_decreases(actions in prop::collection::vec(action_strategy(), 1..100)) {

        let env = Env::default();
        let contract_id = env.register_contract(None, crate::contract::StakingContract);
        let client = StakingContractClient::new(&env, &contract_id);

        let mut last_total: i128 = 0;

        for action in actions {
            match action {
                Action::Stake { user, amount } => {
                    let user_addr = Address::generate(&env);

                    // Perform staking
                    client.stake(&user_addr, &amount);
                }
            }

            // Fetch total pool after action
            let current_total = client.get_total_pool();

            // 🔥 INVARIANT CHECK
            prop_assert!(
                current_total >= last_total,
                "Invariant violated: pool decreased from {} to {}",
                last_total,
                current_total
            );

            last_total = current_total;
        }
    }
}