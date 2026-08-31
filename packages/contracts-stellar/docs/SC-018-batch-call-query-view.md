# SC-018 — Batch Call Query View Gas Optimized

## Overview

Fetching multiple calls in one invocation reduces round-trips and total
ledger reads compared to calling `get_call` N times.

## Design

```rust
pub fn get_calls_batch(env: Env, call_ids: Vec<u64>) -> Vec<Option<Call>> {
    let mut results: Vec<Option<Call>> = Vec::new(&env);
    for i in 0..call_ids.len() {
        let id = call_ids.get(i).unwrap();
        let call: Option<Call> = env.storage().persistent()
            .get(&DataKey::Call(id));
        results.push_back(call);
    }
    results
}
```

## Gas optimization notes

- Returns `Option<Call>` per entry — missing calls return `None` instead
  of panicking, saving the host cost of an error unwind.
- Batch size should be capped (e.g. 50) to avoid exceeding the Soroban
  instruction budget in a single invocation.
- Callers should prefer this over N individual `get_call` invocations
  when reading dashboards or leaderboards.

## Pagination

For unbounded lists use `get_calls_page(env, start_id, limit)` which
reads `limit` consecutive IDs starting at `start_id`.