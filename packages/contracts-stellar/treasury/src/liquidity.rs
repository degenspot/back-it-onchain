use soroban_sdk::{Env, Address};
use crate::types::{Position, PositionSide, Call};
use crate::treasury::get_treasury;

const MIN_LIQUIDITY: i128 = 10; // configurable baseline

pub fn auto_provide_liquidity(
    env: &Env,
    call_id: u64,
    user_amount: i128,
) -> Position {
    let treasury = get_treasury(env);

    // Strategy:
    // Match minimum OR proportional amount
    let short_amount = if user_amount < MIN_LIQUIDITY {
        MIN_LIQUIDITY
    } else {
        user_amount / 10 // 10% hedge
    };

    Position {
        user: treasury,
        amount: short_amount,
        side: PositionSide::Short,
        call_id,
    }
}