# Oracle Service - ed25519 Signing for Stellar

This document describes the Oracle service's ed25519 signing implementation for Stellar/Soroban outcome verification.

## Overview

The Oracle service supports two signing methods:
- **EIP-712** for EVM chains (Base)
- **ed25519** for Stellar/Soroban

The service automatically detects the chain type and uses the appropriate signing method.

## Message Format

For Stellar/Soroban, the oracle signs outcomes using a canonical message format:

```
BackIt:Outcome:{callId}:{outcome}:{finalPrice}:{timestamp}
```

### Components

- **callId**: Unique identifier for the call (number)
- **outcome**: Boolean outcome as string literal (`true` or `false`)
- **finalPrice**: Final price value (number)
- **timestamp**: Unix timestamp in seconds (number)

### Examples

```
BackIt:Outcome:42:true:50000:1700000000
BackIt:Outcome:123:false:25000:1705000000
```

## Key Management

### Environment Variables

The Oracle service requires the following environment variable for Stellar signing:

```bash
STELLAR_ORACLE_SECRET_KEY=SCXJ4DAPQMXLKP3QITADMVLNX5Q7PV4L3BQKVME4N6TL5M2VJJYR7FAS
```

### Security Best Practices

1. **Never commit secret keys** to version control
2. **Use environment variables** or secure secret management systems
3. **Rotate keys regularly** according to your security policy
4. **Restrict access** to key material to only authorized services
5. **Use different keys** for development, staging, and production

### Generating Keys

To generate a new Stellar keypair:

```bash
# Using Stellar SDK
node -e "const { Keypair } = require('@stellar/stellar-sdk'); const kp = Keypair.random(); console.log('Secret:', kp.secret()); console.log('Public:', kp.publicKey());"

# Using stellar-cli (if available)
stellar keys generate oracle --network testnet
```

## Usage

### Getting Public Key

```typescript
const publicKey = oracleService.getStellarPublicKey();
// Returns: GBUWVRJNL5WV5PA45EJ7IYQMEHIM67FJ3T5QVS7NVU7PFNKPDTSQD5PJ
```

### Signing for Stellar

```typescript
const signature = await oracleService.signStellarOutcome(
  42,      // callId
  true,    // outcome
  50000,   // finalPrice
  1700000000 // timestamp
);
// Returns: Buffer (64 bytes)
```

### Chain-Based Signing

```typescript
// Automatically uses correct signing method based on chain
const signature = await oracleService.signOutcomeForChain(
  'stellar', // or 'base'
  42,
  true,
  50000,
  1700000000
);
// Returns: base64 string for Stellar, hex string for Base
```

## Signature Format

ed25519 signatures are 64 bytes long. The service returns them as:
- **Buffer** from `signStellarOutcome()`
- **Base64 string** from `signOutcomeForChain()`

For Soroban contracts, use `BytesN<64>` type:

```rust
pub fn verify_signature(
    env: Env,
    public_key: BytesN<32>,
    message: Bytes,
    signature: BytesN<64>
) -> bool {
    env.crypto().ed25519_verify(&public_key, &message, &signature)
}
```

## Test Vectors

The service includes comprehensive test vectors for verification. Run tests with:

```bash
npm test -- oracle.service.spec.ts
```

### Example Test Vector 1

```
Public Key: GBUWVRJNL5WV5PA45EJ7IYQMEHIM67FJ3T5QVS7NVU7PFNKPDTSQD5PJ
Message: BackIt:Outcome:42:true:50000:1700000000
Signature (hex): 144dd858f05254d8c504b1fc5c694df61ce50402664757c0eeee435b0543cf66287a4c86c9afbf9877dbde7f0c0f3ff3a9d0fc606dba89906c31615319a34f01
Signature (base64): FE3YWPBSVNjFBLH8XGlN9hzlBAJmR1fA7u5DWwVDz2YoekyGya+/mHfb3n8MDz/zqdD8YG26iZBsMWFTGaNPAQ==
```

### Example Test Vector 2

```
Public Key: GBUWVRJNL5WV5PA45EJ7IYQMEHIM67FJ3T5QVS7NVU7PFNKPDTSQD5PJ
Message: BackIt:Outcome:123:false:25000:1705000000
Signature (hex): e323a0927e35bd6750a9eb3d568413f065ab1b1a2fadd392329a86b6ce85df566e2cf019fd177c2e05c27f40f16aed1d74e9251939282dffeb3e2a58cf7bd809
Signature (base64): 4yOgkn41vWdQqes9VoQT8GWrGxovrdOSMpqGts6F31ZuLPAZ/Rd8LgXCf0Dxau0ddOklGTkoLf/rPipYz3vYCQ==
```

## Verification with soroban-cli

You can verify signatures using soroban-cli:

```bash
# Convert base64 signature to hex
echo "FE3YWPBSVNjFBLH8XGlN9hzlBAJmR1fA7u5DWwVDz2YoekyGya+/mHfb3n8MDz/zqdD8YG26iZBsMWFTGaNPAQ==" | base64 -d | xxd -p -c 64

# Use in Soroban contract test or verification
```

## Implementation Details

### Dependencies

- `@stellar/stellar-sdk` - For ed25519 keypair management and signing
- `@nestjs/config` - For environment variable management

### Service Methods

- `constructor()` - Initializes both EVM and Stellar signers
- `getStellarPublicKey()` - Returns the Stellar public key
- `signStellarOutcome()` - Signs with ed25519 for Stellar
- `signOutcome()` - Signs with EIP-712 for EVM
- `signOutcomeForChain()` - Chain-aware signing dispatcher
- `fetchPrice()` - Fetches price from DexScreener (placeholder)

## Future Improvements

1. Add DexScreener API integration for real price fetching
2. Implement signature caching for identical outcomes
3. Add signature timestamp validation
4. Support additional price oracle sources
5. Implement multi-signature verification for critical outcomes
