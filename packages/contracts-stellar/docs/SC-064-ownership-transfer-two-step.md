# SC-064 — Ownership Transfer Two-Step (Propose/Accept)

## Overview

Ownership transfers follow a two-step propose/accept pattern to prevent
accidental transfers to wrong addresses.

## Design

### Storage keys (add to `DataKey`)

```rust
PendingAdmin,  // Option<Address> — proposed new admin
```

### Step 1: propose_admin (current admin only)

```rust
pub fn propose_admin(env: Env, current_admin: Address, new_admin: Address) {
    current_admin.require_auth();
    let stored: Address = env.storage().persistent()
        .get(&DataKey::Admin).expect("Admin not set");
    if current_admin != stored { panic!("Unauthorized"); }
    env.storage().persistent()
        .set(&DataKey::PendingAdmin, &new_admin);
    env.events().publish(
        (Symbol::new(&env, "AdminProposed"),),
        (current_admin, new_admin),
    );
}
```

### Step 2: accept_admin (proposed new admin only)

```rust
pub fn accept_admin(env: Env, new_admin: Address) {
    new_admin.require_auth();
    let pending: Address = env.storage().persistent()
        .get(&DataKey::PendingAdmin).expect("No pending admin");
    if new_admin != pending { panic!("Not pending admin"); }
    env.storage().persistent().set(&DataKey::Admin, &new_admin);
    env.storage().persistent().remove(&DataKey::PendingAdmin);
    env.events().publish(
        (Symbol::new(&env, "AdminTransferred"),), new_admin,
    );
}
```

## Security

- Only the *proposed* address can accept — prevents hijacking.
- Current admin can overwrite `PendingAdmin` to cancel a proposal.