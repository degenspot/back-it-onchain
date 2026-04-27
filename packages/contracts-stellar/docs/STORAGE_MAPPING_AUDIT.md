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