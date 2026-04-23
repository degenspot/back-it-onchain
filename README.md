# Back It (Onchain)

**Back It (Onchain)** is a multi-chain social prediction market platform built on **Base** and **Stellar**. It allows users to create "calls" (predictions), back them with onchain stakes, and build a reputation based on accuracy.

## 🚀 Features

-   **Create Calls**: Make bold predictions about crypto, culture, or tech.
-   **Back & Counter**: Stake on "YES" or "NO" outcomes.
-   **Social Feed**:
    -   **For You**: Algorithmic feed of trending calls.
    -   **Following**: See calls from users you follow.
-   **User Profiles**: Track your reputation, follower counts, and betting history.
-   **Onchain Accountability**: All stakes and outcomes are recorded onchain.
-   **Multi-Chain Support**: Deploy and interact on Base (EVM) or Stellar (Soroban).

## 🔗 Supported Chains

| Chain | Status | Token | Wallet |
|-------|--------|-------|--------|
| **Base** (Ethereum L2) | ✅ Production | USDC (ERC-20) | Coinbase Wallet, MetaMask |
| **Stellar** (Soroban) | 🚧 In Development | USDC (Stellar Native) | Freighter, Lobstr |

## 🛠 Tech Stack

### Frontend
-   **Framework**: Next.js (App Router)
-   **Styling**: Tailwind CSS
-   **Base Integration**: OnchainKit, Wagmi, viem
-   **Stellar Integration**: @stellar/stellar-sdk, @stellar/freighter-api

### Backend
-   **Framework**: NestJS
-   **Database**: PostgreSQL + TypeORM
-   **Indexing**: Multi-chain event indexer (ethers.js + Stellar Horizon)

### Smart Contracts
| Chain | Language | Framework |
|-------|----------|-----------|
| Base | Solidity | Foundry |
| Stellar | Rust | Soroban SDK |

### Oracle
-   **Base**: EIP-712 typed data signatures (secp256k1)
-   **Stellar**: ed25519 signatures

## 📦 Project Structure

```
back-it-onchain/
├── packages/
│   ├── frontend/          # Next.js web application
│   ├── backend/           # NestJS API server
│   ├── contracts/         # Solidity contracts (Base)
│   └── contracts-stellar/ # Soroban contracts (Stellar)
├── ARCHITECTURE.md        # Detailed system design
├── APP-CONCEPT.md         # Product vision
└── README.md
```

### Package Details

| Package | Description |
|---------|-------------|
| `packages/frontend` | Next.js app with multi-chain wallet support |
| `packages/backend` | Unified API server, multi-chain indexer, oracle service |
| `packages/contracts` | Solidity smart contracts for Base (Foundry) |
| `packages/contracts-stellar` | Rust smart contracts for Stellar (Soroban) |

## 🏃‍♂️ Getting Started

### Prerequisites

-   Node.js (v18+)
-   pnpm (v8+)
-   Docker (for PostgreSQL)
-   Foundry (for Base contracts)
-   Rust + soroban-cli (for Stellar contracts)

### Installation

1.  **Clone the repo**
    ```bash
    git clone https://github.com/yourusername/back-it-onchain.git
    cd back-it-onchain
    ```

2.  **Install dependencies**
    ```bash
    pnpm install
    ```

3.  **Setup Environment Variables**
    -   Copy `.env.example` to `.env` in `packages/backend` and `packages/contracts`.
    -   Copy `.env.local.example` to `.env.local` in `packages/frontend`.

4.  **Start Development**
    ```bash
    pnpm dev
    ```
    This starts both frontend and backend concurrently using Turborepo:
    -   **Frontend**: http://localhost:3000
    -   **Backend**: http://localhost:3001

### Chain-Specific Setup

#### Base (EVM)
```bash
cd packages/contracts
forge build
forge test
```

#### Stellar (Soroban)
```bash
cd packages/contracts-stellar
soroban contract build
soroban contract test
```

## 🌐 Multi-Chain Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌─────────────────┐          ┌─────────────────┐           │
│  │  Base Wallet    │          │  Stellar Wallet │           │
│  │  (Wagmi/OCK)    │          │  (Freighter)    │           │
│  └────────┬────────┘          └────────┬────────┘           │
└───────────┼────────────────────────────┼────────────────────┘
            │                            │
            ▼                            ▼
┌───────────────────────┐    ┌───────────────────────┐
│   Base Contracts      │    │  Stellar Contracts    │
│   (Solidity)          │    │  (Soroban/Rust)       │
│   - CallRegistry      │    │  - call_registry      │
│   - OutcomeManager    │    │  - outcome_manager    │
└───────────┬───────────┘    └───────────┬───────────┘
            │                            │
            ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Unified Backend                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Indexer    │  │   Oracle    │  │    Feed     │          │
│  │ (Multi-Chain) │  │  Service   │  │   Service   │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                          │                                   │
│                    ┌─────┴─────┐                            │
│                    │ PostgreSQL │                            │
│                    └───────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

$ pnpm run test:cov
```

# WebSocket Events Gateway

Location: `packages/backend/src/gateways/`

## Architecture

```
Client (browser / mobile)
   │  Socket.io ws://api/events
   │
   ▼
EventsGateway  (/events namespace)
   │
   ├─ handleConnection()       → auto-joins user:<id> room if JWT present
   ├─ subscribeMarket          → joins  market:<marketId> room
   ├─ unsubscribeMarket        → leaves market:<marketId> room
   └─ authenticate             → mid-session login → joins user:<id> room
   │
   └─ @OnEvent() listeners ←── EventEmitter2 (from service layer / Issue 9)
         stake.created         → broadcast → market:<id>
         price.updated         → broadcast → market:<id>
         outcome.proposed      → broadcast → market:<id>
         dispute.raised        → broadcast → market:<id> + user:<staker>
         dispute.resolved      → broadcast → market:<id> + user:<staker>
         user.notification     → send     → user:<id>
```

## Installation

```bash
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io @nestjs/event-emitter
```

## AppModule wiring

See `app.module.snippet.ts`. The two required additions are:
1. `EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' })`
2. `GatewaysModule`

## Client usage

### Connect (anonymous — public market data only)

```typescript
import { io } from 'socket.io-client';

const socket = io('wss://api.example.com/events', {
  transports: ['websocket'],
});

// Subscribe to a market
socket.emit('subscribeMarket', { marketId: 'mkt-abc' });

// Receive live events
socket.on('stakeCreated',    (data) => console.log('new stake', data));
socket.on('priceUpdated',    (data) => console.log('price',     data));
socket.on('outcomeProposed', (data) => console.log('outcome',   data));
socket.on('disputeRaised',   (data) => console.log('dispute',   data));
socket.on('disputeResolved', (data) => console.log('resolved',  data));
```

### Connect (authenticated — private notifications)

**Option A** — JWT in Authorization header at connection time:

```typescript
const socket = io('wss://api.example.com/events', {
  transports: ['websocket'],
  extraHeaders: { Authorization: `Bearer ${token}` },
});
```

**Option B** — Authenticate after connecting (SPA login flow):

```typescript
socket.emit('authenticate', { token: jwtToken });
socket.on('authenticated', ({ userId }) => console.log('logged in as', userId));
```

Private notifications arrive on the `notification` event:

```typescript
socket.on('notification', ({ type, payload, timestamp }) => {
  console.log(`[${type}]`, payload);
});
```

## Emitting events from your service layer

Inject `EventEmitter2` and emit with the dot-delimited keys the gateway listens to:

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StakeCreatedEvent } from '../gateways/events.types';

@Injectable()
export class StakesService {
  constructor(private readonly emitter: EventEmitter2) {}

  async createStake(...) {
    // ... business logic ...

    this.emitter.emit('stake.created', {
      marketId: stake.marketId,
      staker: stake.stakerAddress,
      amount: stake.amount.toString(),
      outcomeIndex: stake.outcomeIndex,
      timestamp: Date.now(),
      txHash: tx.hash,
    } satisfies StakeCreatedEvent);
  }
}
```

## Event payload reference

| EventEmitter2 key   | Socket.io client event | Room(s) notified                      |
|---------------------|------------------------|---------------------------------------|
| `stake.created`     | `stakeCreated`         | `market:<id>`                         |
| `price.updated`     | `priceUpdated`         | `market:<id>`                         |
| `outcome.proposed`  | `outcomeProposed`      | `market:<id>`                         |
| `dispute.raised`    | `disputeRaised`        | `market:<id>` + `user:<staker>`       |
| `dispute.resolved`  | `disputeResolved`      | `market:<id>` + `user:<staker>`       |
| `user.notification` | `notification`         | `user:<id>`                           |

## Imperative broadcasts (inject EventsGateway directly)

```typescript
constructor(private readonly eventsGateway: EventsGateway) {}

// Broadcast to all clients watching a market
this.eventsGateway.broadcastToMarket(marketId, 'customEvent', payload);

// Push to a single user
this.eventsGateway.sendToUser(userId, 'notification', payload);
```

## 🔐 Oracle Design

The oracle service supports both chains with different signature schemes:

| Chain | Signature Scheme | Verification |
|-------|------------------|--------------|
| Base | EIP-712 (secp256k1) | `ecrecover` in Solidity |
| Stellar | ed25519 | `env.crypto().ed25519_verify()` in Soroban |

## 📖 Documentation

-   [Architecture](./ARCHITECTURE.md) - Detailed system design
-   [App Concept](./APP-CONCEPT.md) - Product vision and principles

## 🛣 Roadmap

- [x] Base deployment (MVP)
- [x] Social graph and feed
- [ ] Stellar Soroban contracts
- [ ] Multi-chain wallet selector
- [ ] Cross-chain reputation aggregation
- [ ] Mainnet deployments

## 🤝 Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a PR.

## 📜 License

MIT
