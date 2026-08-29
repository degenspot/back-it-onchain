# SC-022 — Vault Balance Consistency View & Audit

## Problem

`call.vault_balance` is a bookkeeping field updated on every stake, payout,
and early exit. Drift can occur if the vault's actual balance differs from
the sum of all active `vault_balance` fields (e.g. after an upgrade or bug).

## Consistency check getter

```rust
/// Returns the on-chain vault token balance held by this contract.
/// Compare this to the sum of all active call.vault_balance values
/// to detect drift.
pub fn get_vault_token_balance(env: Env, stake_token: Address) -> i128 {
    token::Client::new(&env, &stake_token)
        .balance(&env.current_contract_address())
}
```

## Off-chain audit procedure

1. Call `get_next_call_id` to get total call count.
2. Iterate `get_call(id)` for all unsettled calls, sum `vault_balance`.
3. Call `get_vault_token_balance(stake_token)`.
4. If `actual_balance < sum_vault_balances` → underfunded (critical).
5. If `actual_balance > sum_vault_balances + platform_fees` → surplus
   (likely vault interest — expected behaviour).

## Emit drift alert event

When `finalize_call` is called, optionally emit a `VaultAudit` event
carrying `(call_id, call.vault_balance, actual_on_chain_balance)` so
indexers can track consistency without querying state directly.