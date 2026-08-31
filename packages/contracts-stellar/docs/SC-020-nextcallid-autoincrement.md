# SC-020 — NextCallId Autoincrement with Overflow & Reentrancy Guard

## Overflow guard

`NextCallId` is stored as `u64`. The current `create_call` uses:

```rust
let call_id = env.storage().instance()
    .get(&DataKey::NextCallId).unwrap_or(0u64);
env.storage().instance()
    .set(&DataKey::NextCallId, &(call_id + 1));
```

Replace the plain `+ 1` with a checked add to surface overflow explicitly:

```rust
let next = call_id.checked_add(1)
    .expect("NextCallId overflow");
env.storage().instance().set(&DataKey::NextCallId, &next);
```

With 6-second ledger times and one call per ledger, `u64::MAX` would not
be reached for ~3.5 trillion years — but defensive coding is preferred.

## Reentrancy guard

`create_call` already transfers tokens before writing state (transfer →
vault_deposit → write). The existing `ReentrancyGuard` in `guard.rs` can
be applied at the top of `create_call` and `stake_on_call`:

```rust
pub fn create_call(env: Env, ...) -> u64 {
    let _guard = ReentrancyGuard::new(&env);
    Self::assert_not_paused(&env);
    // ...
}
```

The guard uses instance storage so it is scoped to the current invocation
context and is automatically released on `Drop`.