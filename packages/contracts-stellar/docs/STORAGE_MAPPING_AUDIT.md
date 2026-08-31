# 🧾 Storage Mapping Audit — Outcome Manager

## Purpose
This document defines all storage keys used across the contract system to:
- Prevent key collisions
- Enable formal verification
- Ensure deterministic state layout

---

## 🔐 Storage Model

All storage keys are defined using the `DataKey` enum in:
`src/storage_keys.rs`

This guarantees:
- Type safety
- Namespace isolation
- No accidental overwrites

---

## 🧱 Key Categories

### 1. Global Keys
| Key | Type | Description |
|-----|------|------------|
| ReentrancyLock | bool | Prevents reentrant execution |
| TotalPool | i128 | Total liquidity in protocol |

---

### 2. Market / Outcome Keys
| Key | Type | Description |
|-----|------|------------|
| OutcomePool(Symbol) | i128 | Total pool per market |
| OutcomeStake(Symbol, Address) | i128 | User stake per market |

---

### 3. User Keys
| Key | Type | Description |
|-----|------|------------|
| UserBalance(Address) | i128 | User total balance |
| UserPositions(Address, Symbol) | struct | Positions per market |

---

### 4. Treasury
| Key | Type | Description |
|-----|------|------------|
| TreasuryBalance | i128 | Protocol-owned funds |

---

### 5. Config / Admin
| Key | Type | Description |
|-----|------|------------|
| Admin | Address | Contract admin |
| Config(Symbol) | any | Dynamic config values |

---

## 🚫 Collision Prevention Strategy

- All keys use **enum variants**, not raw strings
- Composite keys use tuples:
  - `(Symbol, Address)` ensures uniqueness
- No shared string keys across modules
- Namespaced by functional domain

---

## 🔍 Formal Verification Notes

- Each storage access is deterministic
- No dynamic string concatenation used
- Key space is finite and enumerable
- Suitable for:
  - Invariant proofs
  - State transition validation
  - Symbolic execution

---

## ⚠️ Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Key reuse | Central enum registry |
| Type mismatch | Rust type system |
| Silent overwrite | Strong typing + variant separation |
| Future expansion collision | Add new enum variants only |

---

## ✅ Audit Checklist

- [x] All storage keys defined in one place
- [x] No raw string keys used
- [x] Composite keys properly structured
- [x] Outcome manager keys isolated
- [x] Ready for formal verification tooling

---

## 📌 Recommendation

Future modules MUST:
- Extend `DataKey` enum
- NEVER introduce raw storage keys
- Update this document on changes
---

## Call Registry (`call_registry`) — SC-011 / SC-012 / SC-013 / SC-014

### Persistent keys (`DataKey`)

| Key | Type | Description | TTL |
|-----|------|-------------|-----|
| `Admin` | `Address` | Contract owner (one-time init, two-step handover) | Bumped via `maybe_bump` |
| `PendingAdmin` | `Address` | Proposed admin awaiting `accept_admin` | Bumped on propose |
| `IsPaused` | `bool` | Global pause flag; state-changing fns guard on this | Bumped on pause/unpause |
| `OutcomeManager` | `Address` | Sole address authorized to `finalize_call` | Bumped on set/read |
| `Call(u64)` | `Call` | Market state including `settled`, `winning_outcome`, `vault_balance` | Bumped on write |
| `UserStake(u64, Address, u32)` | `i128` | Per-user stake on an outcome | Bumped on stake/exit |
| `VaultContract` | `Address` | Optional lending vault | Bumped on set |
| `PlatformFees` | `i128` | Accrued platform fees | Bumped on accrual |
| `WhitelistedToken(Address)` | `bool` | Stake-token allowlist | — |
| `TokenProposal(Address)` | `TokenProposal` | Pending token proposal | — |
| `AuthorizedStaker(Address)` | `bool` | Staker vouch role | — |
| `Claimed(u64, Address)` | `bool` | Payout claim marker | Bumped on claim |
| `NextCallId` | `u64` | Auto-incrementing call id | — |

### Instance keys

| Key | Type | Description |
|-----|------|-------------|
| `FeeConfig` | `FeeConfig` | Platform fee bps + treasury (SC-017) |

### Events (redundant payloads)

| Event | Topics / data | Notes |
|-------|---------------|-------|
| `Paused` | `(true\|false)`, ledger sequence | Emitted on pause / unpause (SC-012) |
| `AdminChanged` | old/new admin, ledger sequence | Init + successful handover (SC-011) |
| `AdminProposed` | current admin, pending, ledger sequence | Propose step |
| `CallFinalized` | `winning_outcome`, `final_price`, `gas_fee`, `vault_balance`, `settled`, `winning_outcome` | Redundant `vault_balance` + `settled` (SC-014) |

### TTL strategy (SC-013)

- Constants: `LEDGERS_PER_YEAR = 5_259_600`, `TTL_THRESHOLD = 432_000` (~30 days)
- Helper: `maybe_bump(env, key)` — if key exists and `get_ttl(key) < TTL_THRESHOLD`, `extend_ttl` to 1 year; otherwise no-op
- Invoked on every meaningful persistent read/write for `Admin`, `IsPaused`, `Call`, `UserStake`, `OutcomeManager`, etc.

### Access control summary

- `initialize` — once only (`AlreadyInitialized` = 8)
- `pause` / `unpause` / `propose_admin` / `set_outcome_manager` / `set_vault` — current admin (`require_admin_auth`)
- `accept_admin` — pending admin only (`NoPendingOwner` = 43 if none)
- `finalize_call` — OutcomeManager only (`Unauthorized` = 1); blocked when paused (`ContractPaused` = 2) or already settled (`CallSettled` = 5)
- `create_call` / `stake_on_call` / `early_exit` / `finalize_call` — `assert_not_paused` → `ContractPaused` (code 2)
