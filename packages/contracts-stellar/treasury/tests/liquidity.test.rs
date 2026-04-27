#[test]
fn test_auto_liquidity_provided() {
    let env = Env::default();

    let user = Address::random(&env);

    let call_id = MarketContract::create_call(
        env.clone(),
        user.clone(),
        100,
    );

    let short_position: Position = env
        .storage()
        .persistent()
        .get(&(call_id, "short"))
        .unwrap();

    assert_eq!(short_position.side, PositionSide::Short);
    assert!(short_position.amount > 0);
}