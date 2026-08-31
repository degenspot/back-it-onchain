# SC-023 — Admin Whitelist Bypass & Batch Whitelist

## Overview

The admin may bypass the 3-vouch proposal process and whitelist tokens directly,
and may whitelist multiple tokens in a single transaction.

## Already implemented

`whitelist_token_admin(env, token)` in `call_registry/src/lib.rs` provides
the single-token admin bypass. It requires `admin.require_auth()` and emits
a `TokenWhitelisted` event.

## Batch whitelist extension

To whitelist multiple tokens atomically, the admin calls `batch_whitelist_tokens`
with a `Vec<Address>`. Each token is processed identically to the single-token
path: any pending proposal is removed and the token is marked whitelisted.

```rust
pub fn batch_whitelist_tokens(env: Env, admin: Address, tokens: Vec<Address>) {
    admin.require_auth();
    let stored_admin: Address = env.storage().persistent()
        .get(&DataKey::Admin).expect("Admin not set");
    if admin != stored_admin { panic!("Unauthorized"); }
    for i in 0..tokens.len() {
        let token = tokens.get(i).unwrap();
        env.storage().persistent()
            .set(&DataKey::WhitelistedToken(token.clone()), &true);
        env.storage().persistent()
            .remove(&DataKey::TokenProposal(token.clone()));
        env.events()
            .publish((Symbol::new(&env, "TokenWhitelisted"), token), ());
    }
}
```

## Storage keys affected

- `DataKey::WhitelistedToken(Address)` — set to `true` for each token
- `DataKey::TokenProposal(Address)` — removed if present