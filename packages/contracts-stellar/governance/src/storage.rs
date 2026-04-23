use soroban_sdk::contracttype;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    Councilor,
    PendingOwner,
    OwnershipTransferTime,
    Fee,
    PendingFee,
    FeeApplyTime,
}
