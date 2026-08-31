# SC-021 — Complete Call Getter Views & Pagination

## Missing getter: `get_next_call_id`

```rust
pub fn get_next_call_id(env: Env) -> u64 {
    env.storage().instance()
        .get(&DataKey::NextCallId).unwrap_or(0)
}
```

## Missing getter: `get_vault_contract`

```rust
pub fn get_vault_contract(env: Env) -> Option<Address> {
    env.storage().persistent().get(&DataKey::VaultContract)
}
```

## Pagination view

Allows frontends to page through all calls without knowing the full ID range:

```rust
/// Returns up to `limit` calls starting at `start_id` (inclusive).
/// Skips missing IDs. Max limit: 50.
pub fn get_calls_page(env: Env, start_id: u64, limit: u32) -> Vec<Call> {
    let max_limit = 50u32;
    let effective_limit = if limit > max_limit { max_limit } else { limit };
    let mut results: Vec<Call> = Vec::new(&env);
    let mut id = start_id;
    let mut count = 0u32;
    while count < effective_limit {
        if let Some(call) = env.storage().persistent()
            .get::<DataKey, Call>(&DataKey::Call(id)) {
            results.push_back(call);
            count += 1;
        }
        id += 1;
        let next_id: u64 = env.storage().instance()
            .get(&DataKey::NextCallId).unwrap_or(0);
        if id >= next_id { break; }
    }
    results
}
```