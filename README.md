# Back It (Onchain)

**Back It (Onchain)** is a social prediction market platform built on **Base**. It allows users to create "calls" (predictions), back them with onchain stakes, and build a reputation based on accuracy.

## 🚀 Features

-   **Create Calls**: Make bold predictions about crypto, culture, or tech.
-   **Back & Counter**: Stake on "YES" or "NO" outcomes.
-   **Social Feed**:
    -   **For You**: Algorithmic feed of trending calls.
    -   **Following**: See calls from users you follow.
-   **User Profiles**: Track your reputation, follower counts, and betting history.
-   **Onchain Accountability**: All stakes and outcomes are recorded on Base.

## 🛠 Tech Stack

-   **Frontend**: Next.js, Tailwind CSS, OnchainKit, Wagmi
-   **Backend**: NestJS, TypeORM, PostgreSQL
-   **Smart Contracts**: Solidity, Foundry
-   **Chain**: Base Sepolia (Testnet)

## 📦 Project Structure

-   `packages/frontend`: Next.js web application
-   `packages/backend`: NestJS API server
-   `packages/contracts`: Smart contracts and Foundry tests

## 🏃‍♂️ Getting Started

### Prerequisites

-   Node.js (v18+)
-   Docker (for PostgreSQL)
-   Foundry (for contracts)

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

## 📜 License

MIT
