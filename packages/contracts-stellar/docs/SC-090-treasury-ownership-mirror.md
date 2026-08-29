# SC-090 — Treasury Ownership Mirror (Two-Step)

## Problem

`governance::ownership` already had a propose/accept sketch, but it was not a
two-step transfer in any meaningful sense:

```rust
pub fn accept_ownership(e: &Env) {          // ← no caller
    let new_owner = e.storage().instance().get(&DataKey::PendingOwner).unwrap();
    if now <= ts + TRANSFER_DELAY { panic!("Too early"); }
    e.storage().instance().set(&DataKey::Owner, &new_owner);
}
```

Anyone could call it — the proposed owner never had to consent, which is the
entire point of the pattern. It also `unwrap()`ed missing state into an opaque
host error, panicked with a bare string, never cleared `PendingOwner` (so an
acceptance could be replayed), and had no events or TTL bumps.

Meanwhile `treasury` was not a crate at all: an empty `Cargo.toml`, no
`lib.rs`, and not a workspace member. Nothing in it was compiled or tested.

## What changed

### 1. `treasury` is now a real crate

Added `treasury/Cargo.toml`, `treasury/src/lib.rs`, and a `Treasury` contract in
`treasury/src/treasury.rs`; registered it in the workspace members.

`src/liquidity.rs` and `tests/liquidity.test.rs` are an unfinished sketch that
references a `crate::types` module which does not exist. Rather than delete or
half-fix another feature's work, `liquidity` is simply not declared in `lib.rs`
and `autotests = false` keeps cargo from trying to build the stray integration
test. Both are left on disk for that feature to finish.

### 2. `governance::ownership` is a real two-step

| Function | Behaviour |
|---|---|
| `initialize_owner(e, owner)` | Seeds `Owner`; `AlreadyInitialized` on re-init |
| `transfer_ownership(e, new_owner)` | Step 1 — records `PendingOwner` + proposal time. **Owner unchanged.** |
| `accept_ownership(e, caller)` | Step 2 — `caller` must equal `PendingOwner`; delay must have elapsed; proposal cleared |
| `cancel_ownership_transfer(e)` | Withdraws a proposal without changing the owner |
| `mirror_owner(e, new_owner)` | Bypasses the two-step for mirroring only; returns whether a stale proposal was cleared |
| `get_owner` / `get_pending_owner` / `get_ownership_ready_at` | Views |

The module is now `pub` so `treasury` can reuse it. It is storage-only by
design — it operates on `e.storage().instance()` of *whichever contract is
executing*, so a contract that links this crate gets its own independent
`Owner`/`PendingOwner` entries. That is what makes the treasury a mirror of the
pattern rather than a reader of governance's storage.

New `ContractError` codes: `OwnerNotSet = 42`, `NoPendingOwner = 43`,
`OwnershipTransferTooEarly = 44`, `InvalidOwner = 45`, `OwnerSourceNotSet = 46`.
Every write bumps the instance TTL (1 year, 30-day threshold — issue #169) and
emits an event carrying both the previous and the new owner.

### 3. Treasury ownership API

```rust
Treasury::initialize(owner, owner_source)
Treasury::propose_owner(caller, new_owner)   // step 1, owner-only
Treasury::accept_owner(new_owner)            // step 2, pending-owner-only
Treasury::cancel_owner_proposal(caller)      // owner-only
Treasury::sync_owner() -> Address            // permissionless mirror
Treasury::set_owner_source(caller, source)   // owner-only
```

`propose_owner` and `accept_owner` are thin wrappers: they add
`require_auth()` and delegate straight to `governance::transfer_ownership` /
`governance::accept_ownership`. The enforcement lives in one place.

## `sync_owner`

The treasury owner must not drift from the registry owner. `sync_owner` reads
the authoritative owner over a cross-contract call and mirrors it:

```rust
#[contractclient(name = "OwnerSourceClient")]
pub trait OwnerSource {
    fn get_owner(env: Env) -> Address;
}
```

Any contract exposing `get_owner() -> Address` can be the source. `call_registry`
now does — `CallRegistry::get_owner` returns the stored `Admin` — so the mirror
points at something real rather than a hypothetical interface.

Three properties worth stating explicitly:

- **Permissionless.** `sync_owner` takes no caller. It can only ever install the
  owner the source *already has*, so there is nothing to gain by triggering it,
  and anyone who notices drift can repair it without waiting on the owner.
- **Stale proposals are discarded.** If the owner actually moves, any in-flight
  local proposal is cleared. A proposal made under the *previous* owner must not
  survive an owner change — otherwise that stale address could accept later and
  displace the mirrored owner. A no-op sync leaves a proposal alone.
- **The source wins.** A treasury-local two-step transfer that the registry
  never mirrored is rolled back by the next sync. This is deliberate (the
  registry is authoritative) and is asserted in
  `test_sync_owner_rolls_back_a_local_transfer_the_registry_did_not_make` so it
  cannot regress silently.

### Trust model

Whoever controls the source contract's owner controls this treasury's owner.
`set_owner_source` is therefore owner-only and emits `OwnerSourceUpdated` with
the previous and new source. Point it only at a contract with an ownership
model at least as strong as this one.

## Acceptance

- **Ownership mirror works** — `test_propose_then_accept_moves_owner`,
  `test_new_owner_can_propose_after_transfer`.
- **Sync correct** — `test_sync_owner_pulls_from_source`,
  `test_sync_owner_is_idempotent_when_already_in_sync`,
  `test_sync_owner_discards_stale_pending_proposal`,
  `test_sync_owner_leaves_pending_alone_when_in_sync`.
- **Two-step enforced** — `test_non_pending_address_cannot_accept` (the
  "non-new accept reverts" criterion), plus
  `test_current_owner_cannot_accept_own_proposal`,
  `test_accept_before_delay_reverts`, `test_accept_cannot_be_replayed`,
  `test_accept_without_proposal_reverts`.

## Note on the 24-hour delay

`TRANSFER_DELAY` is kept at the pre-existing 24 h, and the original strict
comparison (`now <= proposed_at + DELAY` reverts) is preserved — acceptance
requires *more* than 24 h to have passed, not exactly 24 h. The behaviour is
unchanged; it just has an error code now.
