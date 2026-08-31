# SC-088 — Fee Accrual to `PlatformFees` (`call_registry` Hook)

## Problem

Platform fees were accrued ad hoc: `stake_on_call` did an unchecked
`current_fees + fee` with no TTL bump and no event, while `withdraw_payout`
had its own near-duplicate block. `exit_early` charged a 20 % penalty that went
entirely back to the pools — the protocol took nothing. There was no single,
auditable place where the `PlatformFees` persistent entry changes, and no event
an indexer could follow to reconstruct the treasury balance.

## The hook

`accrue_fee` is the one entry point that mutates `DataKey::PlatformFees`.

```rust
pub fn accrue_fee(env: Env, caller: Address, call_id: u64, fee_amount: i128) -> i128
```

Returns the new accumulated `PlatformFees` balance.

### Authorization

Soroban exposes no invoker introspection, so the caller is passed explicitly and
checked against `env.current_contract_address()`:

```rust
caller.require_auth();
if caller != env.current_contract_address() {
    panic!("{:?}", ContractError::Unauthorized);
}
```

`require_auth` alone is not enough — under mocked or delegated auth any address
could satisfy it. The address equality check is what makes the hook
registry-only, and it is what the negative test exercises.

### Validation

| Condition | Error |
|---|---|
| `caller != env.current_contract_address()` | `Unauthorized` (1) |
| `fee_amount <= 0` | `InvalidAmount` (10) |
| `DataKey::Call(call_id)` absent | `CallNotFound` (9) |
| `current_fees + fee_amount` overflows `i128` | `ArithmeticOverflow` (38) |

A negative `fee_amount` is rejected rather than clamped: silently decrementing
the accrued balance would let a caller drain the treasury bookkeeping.

### State change & event

Every accrual does `checked_add`, writes `PlatformFees`, bumps its TTL
(1 year, 30-day threshold — issue #169), and emits:

```
topics: ("FeeAccrued", call_id)
data:   (fee_amount, fees_before, fees_after)
```

`fees_before` and `fees_after` are redundant with the state write on purpose —
an indexer can verify continuity across events without reading storage.

## Call sites

`accrue_fee_internal` is the private body; the public `accrue_fee` wraps it with
the authorization check. Internal callers skip the re-entrant self-call:

| Caller | Fee base | Rate |
|---|---|---|
| `stake_on_call` | amount actually received (post fee-on-transfer) | `compute_fee_basis_points(participant_count)` |
| `exit_early` | the 20 % exit penalty | `compute_fee_basis_points(participant_count)` |
| `withdraw_payout` | the winner's share of the losing pools | `compute_fee_basis_points(participant_count)` |

### `exit_early` accounting

```
user_stake = refund + fee + remaining
  refund    = user_stake * 80 / 100      → transferred to the exiting user
  penalty   = user_stake - refund
  fee       = penalty * fee_bps / 10_000 → accrued to PlatformFees
  remaining = penalty - fee              → redistributed to the other pools
```

`refund + fee` is withdrawn from the vault (mirroring `withdraw_payout`) so the
fee tokens physically sit on the contract balance, ready for
`distribute_dividends`. `call.vault_balance` is decremented by the same
`refund + fee`, keeping it equal to the sum of the outcome pools.

Integer division truncates, so a penalty below `10_000 / fee_bps` accrues
nothing — the rounding remainder stays with the pools, never with the platform.
At 50 bps a stake under 1_000 exits fee-free.

## Acceptance

- Stake 1_000 at 50 bps → `get_platform_fees() == 5`
  (`test_accrue_fee_stake_1k_at_50bps_yields_5`).
- Non-registry caller reverts with `Unauthorized`, even with its own auth
  mocked (`test_accrue_fee_non_registry_caller_reverts`,
  `test_accrue_fee_admin_is_not_the_registry`).

## Pure helpers

`treasury/src/treasury.rs` carries the arithmetic as host-independent helpers —
`fee_from_bps(amount, bps)` and `accrue_fee(current, fee_amount)`, both
returning `Option` on overflow — so the rounding and overflow behaviour can be
reviewed and unit-tested without the Soroban host.
