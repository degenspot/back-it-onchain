use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ContractError {
    Unauthorized = 1,
    NotReady = 2,
    AlreadyPaused = 3,
    NotPaused = 4,
}
