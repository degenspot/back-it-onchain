# SC-024 — Authorized Staker Role Management

## Overview

Authorized stakers are addresses that may vouch for token proposals.
The admin grants or revokes this role via `add_authorized_staker` and
`remove_authorized_staker`.

## Already implemented

Both functions exist in `call_registry/src/lib.rs`:

```rust
pub fn add_authorized_staker(env: Env, staker: Address) { ... }
pub fn remove_authorized_staker(env: Env, staker: Address) { ... }
pub fn is_authorized_staker(env: Env, staker: Address) -> bool { ... }
```

## Storage key

```rust
DataKey::AuthorizedStaker(Address)  // bool, default false
```

## Events emitted

| Event symbol      | Payload   |
|-------------------|-----------|
| `StakerAuthorized` | `staker` |
| `StakerRevoked`   | `staker`  |

## Role check in vouch flow

`vouch_for_token` calls `is_authorized_staker_internal` and panics with
`ContractError::NotAuthorizedStaker` if the caller is not authorized.

## Listing all authorized stakers

Soroban persistent storage does not support range scans. Maintain an
off-chain index by listening to `StakerAuthorized` / `StakerRevoked` events.