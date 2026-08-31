# SC-066 — Display Impl for `ContractError` (Debug String)

## Overview

`ContractError` uses `#[contracterror]` which generates `u32` wire codes.
A human-readable display string improves SDK error messages and debugging.

## Implementation

Because `#![no_std]` is in effect, we cannot use `std::fmt`. Instead,
provide a `const fn` that maps each variant to a static string:

```rust
impl ContractError {
    /// Returns a static string description for each error variant.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::ContractPaused => "contract_paused",
            Self::AdminNotSet => "admin_not_set",
            Self::CallEnded => "call_ended",
            Self::CallSettled => "call_settled",
            Self::CallNotEnded => "call_not_ended",
            Self::CallNotSettled => "call_not_settled",
            Self::AlreadyInitialized => "already_initialized",
            Self::CallNotFound => "call_not_found",
            Self::InvalidAmount => "invalid_amount",
            Self::InvalidEndTime => "invalid_end_time",
            Self::InvalidOutcomeIndex => "invalid_outcome_index",
            Self::InvalidWinningOutcome => "invalid_winning_outcome",
            Self::TooFewOutcomes => "too_few_outcomes",
            Self::TooManyOutcomes => "too_many_outcomes",
            Self::ArithmeticOverflow => "arithmetic_overflow",
            _ => "unknown_error",
        }
    }
}
```

## Usage in SDK

```typescript
// Frontend TypeScript
const label = errorCodeToLabel[err.code] ?? "unknown_error";
```

## Note on `#![no_std]`

`core::fmt::Display` is available in `no_std` contexts but requires
`write!` from `core::fmt`. Use `as_str()` instead to avoid the
allocator requirement entirely.