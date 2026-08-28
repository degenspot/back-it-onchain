#![cfg(test)]

use crate::treasury::*;
use governance::ownership::TRANSFER_DELAY;
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Ledger},
    Address, Env,
};

// ── Mock owner source ────────────────────────────────────────────────────────
//
// Stands in for `call_registry`, which exposes `get_owner() -> Address`.

#[contract]
pub struct MockOwnerSource;

#[contractimpl]
impl MockOwnerSource {
    pub fn init(env: Env, owner: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("OWNER"), &owner);
    }

    pub fn set_owner(env: Env, owner: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("OWNER"), &owner);
    }

    pub fn get_owner(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&symbol_short!("OWNER"))
            .unwrap()
    }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

struct Fixture<'a> {
    treasury: TreasuryClient<'a>,
    source: MockOwnerSourceClient<'a>,
    owner: Address,
}

/// Register a treasury owned by a fresh address, mirroring a mock source whose
/// owner is the same address (i.e. already in sync).
fn setup(env: &Env) -> Fixture<'_> {
    let owner = Address::generate(env);

    let source_id = env.register_contract(None, MockOwnerSource);
    let source = MockOwnerSourceClient::new(env, &source_id);
    source.init(&owner);

    let treasury_id = env.register_contract(None, Treasury);
    let treasury = TreasuryClient::new(env, &treasury_id);
    treasury.initialize(&owner, &source_id);

    Fixture {
        treasury,
        source,
        owner,
    }
}

/// Move the ledger past the ownership transfer delay.
fn advance_past_delay(env: &Env) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + TRANSFER_DELAY + 1);
}

// ── Initialization ───────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_owner_and_source() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);

    assert_eq!(f.treasury.get_owner(), f.owner);
    assert_eq!(f.treasury.get_pending_owner(), None);
    assert_eq!(f.treasury.get_ownership_ready_at(), None);
    assert_eq!(f.treasury.get_owner_source(), f.source.address);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // AlreadyInitialized
fn test_initialize_twice_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let usurper = Address::generate(&env);
    f.treasury.initialize(&usurper, &f.source.address);
}

// ── Two-step transfer: the happy path ────────────────────────────────────────

#[test]
fn test_propose_then_accept_moves_owner() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let new_owner = Address::generate(&env);

    let proposed_at = env.ledger().timestamp();
    f.treasury.propose_owner(&f.owner, &new_owner);

    // Step 1 records the proposal but must NOT move the owner.
    assert_eq!(f.treasury.get_owner(), f.owner);
    assert_eq!(f.treasury.get_pending_owner(), Some(new_owner.clone()));
    assert_eq!(
        f.treasury.get_ownership_ready_at(),
        Some(proposed_at + TRANSFER_DELAY)
    );

    advance_past_delay(&env);
    f.treasury.accept_owner(&new_owner);

    // Step 2 moves it and clears the proposal.
    assert_eq!(f.treasury.get_owner(), new_owner);
    assert_eq!(f.treasury.get_pending_owner(), None);
    assert_eq!(f.treasury.get_ownership_ready_at(), None);
}

#[test]
fn test_new_owner_can_propose_after_transfer() {
    // The mirror is not a one-shot: the new owner holds full owner powers.
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let second = Address::generate(&env);
    let third = Address::generate(&env);

    f.treasury.propose_owner(&f.owner, &second);
    advance_past_delay(&env);
    f.treasury.accept_owner(&second);

    f.treasury.propose_owner(&second, &third);
    advance_past_delay(&env);
    f.treasury.accept_owner(&third);

    assert_eq!(f.treasury.get_owner(), third);
}

#[test]
fn test_reproposing_retargets_and_restarts_delay() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let first = Address::generate(&env);
    let second = Address::generate(&env);

    f.treasury.propose_owner(&f.owner, &first);
    advance_past_delay(&env);

    let repropose_at = env.ledger().timestamp();
    f.treasury.propose_owner(&f.owner, &second);

    assert_eq!(f.treasury.get_pending_owner(), Some(second.clone()));
    assert_eq!(
        f.treasury.get_ownership_ready_at(),
        Some(repropose_at + TRANSFER_DELAY)
    );

    advance_past_delay(&env);
    f.treasury.accept_owner(&second);
    assert_eq!(f.treasury.get_owner(), second);
}

// ── Two-step transfer: enforcement ───────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // Unauthorized
fn test_non_pending_address_cannot_accept() {
    // Acceptance criterion: a "non-new" accept reverts.
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let new_owner = Address::generate(&env);
    let stranger = Address::generate(&env);

    f.treasury.propose_owner(&f.owner, &new_owner);
    advance_past_delay(&env);
    f.treasury.accept_owner(&stranger);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // Unauthorized
fn test_current_owner_cannot_accept_own_proposal() {
    // The proposer must not be able to push the transfer through alone —
    // that would collapse the two steps back into one.
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let new_owner = Address::generate(&env);

    f.treasury.propose_owner(&f.owner, &new_owner);
    advance_past_delay(&env);
    f.treasury.accept_owner(&f.owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #44)")] // OwnershipTransferTooEarly
fn test_accept_before_delay_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let new_owner = Address::generate(&env);

    f.treasury.propose_owner(&f.owner, &new_owner);
    f.treasury.accept_owner(&new_owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")] // NoPendingOwner
fn test_accept_without_proposal_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let opportunist = Address::generate(&env);
    f.treasury.accept_owner(&opportunist);
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")] // NoPendingOwner
fn test_accept_cannot_be_replayed() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let new_owner = Address::generate(&env);

    f.treasury.propose_owner(&f.owner, &new_owner);
    advance_past_delay(&env);
    f.treasury.accept_owner(&new_owner);

    // The proposal is consumed; a second acceptance has nothing to act on.
    f.treasury.accept_owner(&new_owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // Unauthorized
fn test_non_owner_cannot_propose() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let stranger = Address::generate(&env);
    let target = Address::generate(&env);

    f.treasury.propose_owner(&stranger, &target);
}

#[test]
#[should_panic(expected = "Error(Contract, #45)")] // InvalidOwner
fn test_cannot_propose_current_owner() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    f.treasury.propose_owner(&f.owner, &f.owner);
}

#[test]
fn test_cancel_proposal_blocks_acceptance() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let new_owner = Address::generate(&env);

    f.treasury.propose_owner(&f.owner, &new_owner);
    f.treasury.cancel_owner_proposal(&f.owner);

    assert_eq!(f.treasury.get_pending_owner(), None);
    assert_eq!(f.treasury.get_owner(), f.owner);

    advance_past_delay(&env);
    // The cancelled proposal is gone: accepting now reverts with NoPendingOwner.
    assert!(f.treasury.try_accept_owner(&new_owner).is_err());
    assert_eq!(f.treasury.get_owner(), f.owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // Unauthorized
fn test_non_owner_cannot_cancel_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let new_owner = Address::generate(&env);
    f.treasury.propose_owner(&f.owner, &new_owner);

    let stranger = Address::generate(&env);
    f.treasury.cancel_owner_proposal(&stranger);
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")] // NoPendingOwner
fn test_cancel_without_proposal_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    f.treasury.cancel_owner_proposal(&f.owner);
}

// ── sync_owner ───────────────────────────────────────────────────────────────

#[test]
fn test_sync_owner_pulls_from_source() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let registry_owner = Address::generate(&env);

    // The registry's ownership moved without the treasury hearing about it.
    f.source.set_owner(&registry_owner);
    assert_eq!(f.treasury.get_owner(), f.owner);

    let synced = f.treasury.sync_owner();

    assert_eq!(synced, registry_owner);
    assert_eq!(f.treasury.get_owner(), registry_owner);
}

#[test]
fn test_sync_owner_is_idempotent_when_already_in_sync() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);

    assert_eq!(f.treasury.sync_owner(), f.owner);
    assert_eq!(f.treasury.sync_owner(), f.owner);
    assert_eq!(f.treasury.get_owner(), f.owner);
}

#[test]
fn test_sync_owner_is_permissionless() {
    // Anyone may repair drift; sync can only install the owner the source
    // already has, so there is nothing to gain by triggering it.
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let registry_owner = Address::generate(&env);
    f.source.set_owner(&registry_owner);

    // No caller argument at all — the source is the only authority consulted.
    assert_eq!(f.treasury.sync_owner(), registry_owner);
}

#[test]
fn test_sync_owner_discards_stale_pending_proposal() {
    // A proposal made by the OLD owner must not survive a sync: otherwise the
    // stale target could accept later and displace the mirrored owner.
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let stale_target = Address::generate(&env);
    f.treasury.propose_owner(&f.owner, &stale_target);
    assert_eq!(f.treasury.get_pending_owner(), Some(stale_target.clone()));

    let registry_owner = Address::generate(&env);
    f.source.set_owner(&registry_owner);
    f.treasury.sync_owner();

    assert_eq!(f.treasury.get_owner(), registry_owner);
    assert_eq!(f.treasury.get_pending_owner(), None);
    assert_eq!(f.treasury.get_ownership_ready_at(), None);

    advance_past_delay(&env);
    assert!(f.treasury.try_accept_owner(&stale_target).is_err());
    assert_eq!(f.treasury.get_owner(), registry_owner);
}

#[test]
fn test_sync_owner_leaves_pending_alone_when_in_sync() {
    // An in-flight proposal survives a no-op sync — only an actual owner change
    // invalidates it.
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let new_owner = Address::generate(&env);
    f.treasury.propose_owner(&f.owner, &new_owner);

    f.treasury.sync_owner();

    assert_eq!(f.treasury.get_pending_owner(), Some(new_owner.clone()));
    advance_past_delay(&env);
    f.treasury.accept_owner(&new_owner);
    assert_eq!(f.treasury.get_owner(), new_owner);
}

#[test]
fn test_two_step_result_survives_a_sync_when_registry_follows() {
    // End-to-end mirror: the treasury's own two-step lands, the registry is
    // updated to match, and a later sync is a no-op rather than a rollback.
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let new_owner = Address::generate(&env);

    f.treasury.propose_owner(&f.owner, &new_owner);
    advance_past_delay(&env);
    f.treasury.accept_owner(&new_owner);
    assert_eq!(f.treasury.get_owner(), new_owner);

    f.source.set_owner(&new_owner);
    assert_eq!(f.treasury.sync_owner(), new_owner);
    assert_eq!(f.treasury.get_owner(), new_owner);
}

#[test]
fn test_sync_owner_rolls_back_a_local_transfer_the_registry_did_not_make() {
    // The registry is authoritative: a treasury-local transfer that the
    // registry never mirrored is undone by the next sync. This is the
    // documented trust model, asserted so it cannot regress silently.
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let local_only = Address::generate(&env);

    f.treasury.propose_owner(&f.owner, &local_only);
    advance_past_delay(&env);
    f.treasury.accept_owner(&local_only);
    assert_eq!(f.treasury.get_owner(), local_only);

    assert_eq!(f.treasury.sync_owner(), f.owner);
    assert_eq!(f.treasury.get_owner(), f.owner);
}

// ── Owner source management ──────────────────────────────────────────────────

#[test]
fn test_set_owner_source_repoints_the_mirror() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let other_owner = Address::generate(&env);
    let other_id = env.register_contract(None, MockOwnerSource);
    let other = MockOwnerSourceClient::new(&env, &other_id);
    other.init(&other_owner);

    f.treasury.set_owner_source(&f.owner, &other_id);
    assert_eq!(f.treasury.get_owner_source(), other_id);
    assert_eq!(f.treasury.sync_owner(), other_owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // Unauthorized
fn test_non_owner_cannot_set_owner_source() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let stranger = Address::generate(&env);
    f.treasury.set_owner_source(&stranger, &f.source.address);
}

// ── Legacy treasury address ──────────────────────────────────────────────────

#[test]
fn test_set_and_get_treasury_address() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let payout = Address::generate(&env);

    f.treasury.set_treasury(&f.owner, &payout);
    assert_eq!(f.treasury.get_treasury(), payout);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // Unauthorized
fn test_non_owner_cannot_set_treasury_address() {
    let env = Env::default();
    env.mock_all_auths();

    let f = setup(&env);
    let stranger = Address::generate(&env);
    let payout = Address::generate(&env);
    f.treasury.set_treasury(&stranger, &payout);
}

// ── Pure helpers (SC-016 / SC-017 / SC-088) ──────────────────────────────────

#[test]
fn test_fee_from_bps_matches_sc088_acceptance() {
    // SC-088: stake 1_000 at 50 bps → fee 5.
    assert_eq!(fee_from_bps(1_000, 50), Some(5));
    assert_eq!(fee_from_bps(10_000, 50), Some(50));
    assert_eq!(fee_from_bps(1_000, 200), Some(20));
}

#[test]
fn test_fee_from_bps_truncates_and_guards() {
    assert_eq!(fee_from_bps(199, 50), Some(0)); // rounds down to nothing
    assert_eq!(fee_from_bps(0, 50), Some(0));
    assert_eq!(fee_from_bps(-1, 50), Some(0));
    assert_eq!(fee_from_bps(1_000, 0), Some(0));
    assert_eq!(fee_from_bps(i128::MAX, 50), None); // overflow on mul
}

#[test]
fn test_accrue_fee_is_checked() {
    assert_eq!(accrue_fee(0, 5), Some(5));
    assert_eq!(accrue_fee(5, 45), Some(50));
    assert_eq!(accrue_fee(10, 0), Some(10));
    assert_eq!(accrue_fee(10, -1), None); // never decrements
    assert_eq!(accrue_fee(i128::MAX, 1), None); // overflow on add
}

#[test]
fn test_fee_bps_range_and_proportional_share() {
    assert!(!is_valid_fee_bps(49));
    assert!(is_valid_fee_bps(50));
    assert!(is_valid_fee_bps(200));
    assert!(!is_valid_fee_bps(201));

    assert_eq!(proportional_share(50, 3, 6), 25);
    assert_eq!(proportional_share(50, 0, 6), 0);
    assert_eq!(proportional_share(50, 1, 0), 0); // zero denominator
    assert_eq!(proportional_share(-1, 1, 1), 0);
}
