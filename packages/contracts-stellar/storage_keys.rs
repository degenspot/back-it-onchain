use soroban_sdk::{contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    // 🔐 Global flags
    ReentrancyLock,

    // 📊 Pool / market data
    TotalPool,
    MarketState(Symbol),          // market_id

    // 👤 User-specific
    UserBalance(Address),
    UserPositions(Address, Symbol), // (user, market_id)

    // 🎯 Outcome management
    OutcomePool(Symbol),          // market_id
    OutcomeStake(Symbol, Address), // (market_id, user)

    // 💰 Treasury
    TreasuryBalance,

    // 🧾 Metadata / config
    Admin,
    Config(Symbol),

    // 🧪 Testing / debug (optional)
    DebugFlag(Symbol),
}