#![no_std]

mod dispute;
mod storage;
mod types;
mod errors;
mod events;

#[cfg(test)]
mod tests;

pub use dispute::DisputeContractClient;

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
use types::{CallOutcome, DisputeResolution};
use errors::ContractError;

#[contract]
pub struct DisputeContract;

#[contractimpl]
impl DisputeContract {
    /// Initialize the contract with an admin address and proposal window (in seconds).
    /// Default proposal_window: 86400 (24 hours).
    pub fn initialize(
        env: Env,
        admin: Address,
        proposal_window: u64,
        min_bond: i128,
    ) -> Result<(), ContractError> {
        if storage::is_initialized(&env) {
            return Err(ContractError::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_proposal_window(&env, proposal_window);
        storage::set_min_bond(&env, min_bond);
        events::emit_initialized(&env, &admin, proposal_window, min_bond);
        Ok(())
    }

    /// Submit the first outcome for a call. Starts the proposal window clock.
    pub fn submit_outcome(
        env: Env,
        call_id: u64,
        submitter: Address,
        outcome: CallOutcome,
    ) -> Result<(), ContractError> {
        submitter.require_auth();
        storage::assert_call_not_exists(&env, call_id)?;

        let now = env.ledger().timestamp();
        let window = storage::get_proposal_window(&env);

        let call_record = types::CallRecord {
            call_id,
            submitter: submitter.clone(),
            outcome: outcome.clone(),
            submitted_at: now,
            window_expires_at: now + window,
            state: types::CallState::Proposed,
            dispute: None,
        };

        storage::save_call(&env, call_id, &call_record);
        events::emit_outcome_submitted(&env, call_id, &submitter, &outcome, now + window);
        Ok(())
    }

    /// Dispute a proposed outcome by locking a bond.
    /// Can only be called while the proposal window is open and the call is in Proposed state.
    pub fn dispute_outcome(
        env: Env,
        call_id: u64,
        staker: Address,
        bond_amount: i128,
    ) -> Result<(), ContractError> {
        staker.require_auth();

        let min_bond = storage::get_min_bond(&env);
        if bond_amount < min_bond {
            return Err(ContractError::BondTooLow);
        }

        let mut record = storage::load_call(&env, call_id)?;

        // Ensure the call is still in the proposal window
        let now = env.ledger().timestamp();
        if now > record.window_expires_at {
            return Err(ContractError::ProposalWindowExpired);
        }

        // Only Proposed calls can be disputed
        if record.state != types::CallState::Proposed {
            return Err(ContractError::InvalidStateTransition);
        }

        // Transfer the bond from staker to this contract
        let token = storage::get_token(&env)?;
        let contract_address = env.current_contract_address();
        token::transfer(&env, &token, &staker, &contract_address, bond_amount)?;

        // Record the dispute
        record.state = types::CallState::Disputed;
        record.dispute = Some(types::DisputeRecord {
            staker: staker.clone(),
            bond_amount,
            disputed_at: now,
            resolution: None,
        });

        storage::save_call(&env, call_id, &record);
        events::emit_dispute_raised(&env, call_id, &staker, bond_amount, now);
        Ok(())
    }

    /// Admin/DAO resolves a disputed call.
    /// `resolution` specifies whether the original outcome stands or is overturned,
    /// and whether the bond is returned or slashed.
    pub fn resolve_dispute(
        env: Env,
        call_id: u64,
        resolution: DisputeResolution,
        final_outcome: CallOutcome,
    ) -> Result<(), ContractError> {
        let admin = storage::get_admin(&env);
        admin.require_auth();

        let mut record = storage::load_call(&env, call_id)?;

        if record.state != types::CallState::Disputed {
            return Err(ContractError::NotDisputed);
        }

        let dispute = record.dispute.as_mut().ok_or(ContractError::NoDisputeRecord)?;
        let staker = dispute.staker.clone();
        let bond_amount = dispute.bond_amount;

        let token = storage::get_token(&env)?;
        let contract_address = env.current_contract_address();

        match resolution {
            DisputeResolution::UpholdDispute => {
                // Dispute was valid — return bond to staker
                token::transfer(&env, &token, &contract_address, &staker, bond_amount)?;
                dispute.resolution = Some(resolution.clone());
                record.outcome = final_outcome.clone();
                record.state = types::CallState::Resolved;
            }
            DisputeResolution::RejectDispute => {
                // Dispute was frivolous — slash the bond to the admin/treasury
                token::transfer(&env, &token, &contract_address, &admin, bond_amount)?;
                dispute.resolution = Some(resolution.clone());
                // Original outcome stands; final_outcome parameter is ignored
                record.state = types::CallState::Resolved;
            }
        }

        storage::save_call(&env, call_id, &record);
        events::emit_dispute_resolved(&env, call_id, &resolution, &final_outcome);
        Ok(())
    }

    /// Finalize a call after the proposal window closes with no dispute.
    pub fn finalize_outcome(env: Env, call_id: u64) -> Result<(), ContractError> {
        let mut record = storage::load_call(&env, call_id)?;

        if record.state != types::CallState::Proposed {
            return Err(ContractError::InvalidStateTransition);
        }

        let now = env.ledger().timestamp();
        if now <= record.window_expires_at {
            return Err(ContractError::ProposalWindowStillOpen);
        }

        record.state = types::CallState::Finalized;
        storage::save_call(&env, call_id, &record);
        events::emit_outcome_finalized(&env, call_id, &record.outcome);
        Ok(())
    }

    // ── View functions ──────────────────────────────────────────────────────

    pub fn get_call(env: Env, call_id: u64) -> Result<types::CallRecord, ContractError> {
        storage::load_call(&env, call_id)
    }

    pub fn get_admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    pub fn get_proposal_window(env: Env) -> u64 {
        storage::get_proposal_window(&env)
    }

    pub fn get_min_bond(env: Env) -> i128 {
        storage::get_min_bond(&env)
    }

    // ── Admin helpers ───────────────────────────────────────────────────────

    /// Set (or update) the ERC-20/SEP-41 token used for bonds.
    pub fn set_token(env: Env, token: Address) -> Result<(), ContractError> {
        storage::get_admin(&env).require_auth();
        storage::set_token(&env, &token);
        Ok(())
    }

    /// Transfer admin rights (e.g., to a DAO multisig).
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), ContractError> {
        let current = storage::get_admin(&env);
        current.require_auth();
        storage::set_admin(&env, &new_admin);
        events::emit_admin_transferred(&env, &current, &new_admin);
        Ok(())
    }

    /// Update the proposal window — only affects future calls.
    pub fn set_proposal_window(env: Env, seconds: u64) -> Result<(), ContractError> {
        storage::get_admin(&env).require_auth();
        storage::set_proposal_window(&env, seconds);
        Ok(())
    }

    /// Update the minimum bond — only affects future disputes.
    pub fn set_min_bond(env: Env, amount: i128) -> Result<(), ContractError> {
        storage::get_admin(&env).require_auth();
        storage::set_min_bond(&env, amount);
        Ok(())
    }
}

/// Thin wrapper around the SEP-41 token `transfer` interface.
mod token {
    use soroban_sdk::{Address, Env, IntoVal};
    use crate::errors::ContractError;

    pub fn transfer(
        env: &Env,
        token: &Address,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        let client = soroban_sdk::token::Client::new(env, token);
        client.transfer(from, to, &amount);
        Ok(())
    }
}
