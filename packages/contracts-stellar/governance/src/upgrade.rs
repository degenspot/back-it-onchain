//! Contract WASM upgrade + schema-version migration hook (SC-008).
//!
//! Mirrors `ownership`'s design: storage-only helpers over
//! `e.storage().instance()` of whichever contract links this crate, so each
//! contract gets its own independent upgrade/schema-version state. Uses a
//! dedicated `Symbol` key directly rather than extending the shared
//! `storage::DataKey` enum, so this module stays a self-contained addition.
//!
//! `migrate()` here is deliberately generic: the actual state transformation
//! for a given contract's storage layout is necessarily contract-specific,
//! so this module owns the version bookkeeping (has a migration for version
//! N already run? bump to N once it has) and leaves the transform itself to
//! the calling contract's own `migrate` entry point.

use crate::errors::ContractError;
use crate::ownership;
use soroban_sdk::{panic_with_error, Address, BytesN, Env, Symbol};

fn schema_version_key(e: &Env) -> Symbol {
    Symbol::new(e, "SCHEMA_VER")
}

/// Current schema version. Defaults to 0 for a contract that has never
/// migrated.
pub fn get_schema_version(e: &Env) -> u32 {
    e.storage()
        .instance()
        .get(&schema_version_key(e))
        .unwrap_or(0)
}

/// Upgrade the currently-executing contract's WASM to `new_wasm_hash`.
///
/// Only the contract owner (see `ownership::get_owner`) may call this.
/// `caller` must additionally satisfy `require_auth()`, so a stolen owner
/// *address* without a matching signature still can't upgrade.
///
/// # Panics
/// - `ContractError::Unauthorized` if `caller` is not the owner.
pub fn upgrade(e: &Env, caller: &Address, new_wasm_hash: BytesN<32>) {
    let owner = ownership::get_owner(e);
    if &owner != caller {
        panic_with_error!(e, ContractError::Unauthorized);
    }
    caller.require_auth();

    e.deployer()
        .update_current_contract_wasm(new_wasm_hash.clone());

    e.events().publish(
        (Symbol::new(e, "ContractUpgraded"), caller.clone()),
        new_wasm_hash,
    );
}

/// Record that migration to `target_version` has completed, so a later call
/// to `migrate` (post-upgrade) can tell whether its transform already ran.
///
/// Callers should invoke this *after* successfully transforming storage for
/// `target_version`, never before — this is the "did we already migrate?"
/// marker, not a lock.
///
/// # Panics
/// - `ContractError::Unauthorized` if `caller` is not the owner.
/// - Panics (plain) if `target_version` does not immediately follow the
///   current schema version — migrations must be applied in order, one at a
///   time, so a contract can't accidentally skip a transform.
pub fn mark_migrated(e: &Env, caller: &Address, target_version: u32) {
    let owner = ownership::get_owner(e);
    if &owner != caller {
        panic_with_error!(e, ContractError::Unauthorized);
    }
    caller.require_auth();

    let current = get_schema_version(e);
    if target_version != current + 1 {
        panic!("migrations must be applied one version at a time, in order");
    }

    e.storage()
        .instance()
        .set(&schema_version_key(e), &target_version);

    e.events().publish(
        (Symbol::new(e, "SchemaMigrated"), caller.clone()),
        (current, target_version),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, contractimpl, testutils::Address as _, Env};

    // Governance's storage/event/auth helpers operate on "whichever contract
    // is currently executing" (see the module docs), so exercising them
    // needs a real contract invocation, not a raw `env.as_contract` closure
    // (mock_all_auths hooks into the standard client-invocation path, which
    // a bare closure bypasses). This thin wrapper contract exists purely to
    // drive the module under test through its generated Client, matching how
    // `call_registry`'s own tests exercise its contract methods.
    #[contract]
    struct DummyContract;

    #[contractimpl]
    impl DummyContract {
        pub fn init(e: Env, owner: Address) {
            ownership::initialize_owner(&e, &owner);
        }

        pub fn upgrade(e: Env, caller: Address, new_wasm_hash: BytesN<32>) {
            upgrade(&e, &caller, new_wasm_hash);
        }

        pub fn mark_migrated(e: Env, caller: Address, target_version: u32) {
            mark_migrated(&e, &caller, target_version);
        }

        pub fn schema_version(e: Env) -> u32 {
            get_schema_version(&e)
        }
    }

    fn setup(e: &Env) -> (DummyContractClient<'_>, Address) {
        let contract_id = e.register_contract(None, DummyContract);
        let client = DummyContractClient::new(e, &contract_id);
        let owner = Address::generate(e);
        client.init(&owner);
        (client, owner)
    }

    #[test]
    #[should_panic(expected = "MissingValue")]
    fn upgrade_by_owner_passes_authorization_and_reaches_wasm_swap() {
        // The test environment has no real WASM installed under this
        // fabricated hash, so `update_current_contract_wasm` itself fails
        // with a storage MissingValue host error — a different failure than
        // Unauthorized (see the non-owner test below), which proves the
        // authorization gate was passed and this call actually reached the
        // real upgrade operation rather than being rejected earlier.
        let e = Env::default();
        e.mock_all_auths();
        let (client, owner) = setup(&e);

        client.upgrade(&owner, &BytesN::from_array(&e, &[7u8; 32]));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn upgrade_by_non_owner_reverts() {
        let e = Env::default();
        e.mock_all_auths();
        let (client, _owner) = setup(&e);
        let attacker = Address::generate(&e);

        client.upgrade(&attacker, &BytesN::from_array(&e, &[7u8; 32]));
    }

    #[test]
    fn schema_version_defaults_to_zero_then_increments() {
        let e = Env::default();
        e.mock_all_auths();
        let (client, owner) = setup(&e);

        assert_eq!(client.schema_version(), 0);
        client.mark_migrated(&owner, &1);
        assert_eq!(client.schema_version(), 1);
        client.mark_migrated(&owner, &2);
        assert_eq!(client.schema_version(), 2);
    }

    #[test]
    #[should_panic(expected = "migrations must be applied one version at a time")]
    fn mark_migrated_rejects_skipped_version() {
        let e = Env::default();
        e.mock_all_auths();
        let (client, owner) = setup(&e);

        client.mark_migrated(&owner, &2); // must be 1 first
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn mark_migrated_by_non_owner_reverts() {
        let e = Env::default();
        e.mock_all_auths();
        let (client, _owner) = setup(&e);
        let attacker = Address::generate(&e);

        client.mark_migrated(&attacker, &1);
    }
}
