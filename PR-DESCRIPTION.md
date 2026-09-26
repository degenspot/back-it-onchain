# PR: Stellar Indexer Infrastructure (BE-001 → BE-004)

## Summary

Four tightly-coupled backend tasks that together deliver a production-grade
Soroban event ingestion pipeline with distributed coordination.

---

## BE-001 · Soroban RPC Event Streaming Service

**Branch**: `feature/be-001-soroban-event-streaming`  
**Files**: `stellar-indexer.service.ts`, `indexer.module.ts`

### What was built
- Replaced the naive `setInterval` poller with a recursive `setTimeout` loop
  so polls never overlap under slow RPCs or large backlogs.
- **Adaptive polling interval**: backs off exponentially (4s → 60s) when no
  new ledgers are available; resets to 6s when events flow in.
- **Multi-contract, single-call pagination**: all watched contracts
  (`call_registry`, `outcome_manager`, `treasury`) are batched into one
  `getEvents` RPC call per page; a cursor loop follows pages until exhausted.
- **Full SCVal decoder** covering U64/I128/U128 as BigInt decimal strings
  (no JS Number precision loss), Address (G.../C...), Symbol, String, Bytes,
  Vec, Map, Bool, Void.
- **Exponential-backoff retry**: `withRetry` (8 attempts, 1s base, 30s cap,
  ±25% jitter) wraps every RPC call. Recovers automatically from 60s network
  partitions.
- **Checkpoint resumption**: uses `LedgerCheckpointStore` — on restart resumes
  from the last committed ledger, no gaps, no re-scans.
- Emits typed NestJS domain events (`stellar.CallCreated`, `stellar.StakeAdded`,
  etc.) after each successful upsert.
- Uses the globally-injected `SorobanRpcClient` (already `@Retryable`).

### Tests added
`stellar-indexer.service.spec.ts` — checkpoint resumption, pagination cursor,
error recovery, SCVal decoding (including >MAX_SAFE_INTEGER U64), graceful stop.

---

## BE-002 · Ledger Reorganization Detection & Idempotent Event Rewind Engine

**Branch**: `feature/be-002-ledger-reorg-rewind`  
**Files**: `ledger-checkpoint.service.ts`, `call-event-store.service.ts`,
`ledger-checkpoint.entity.ts`, migration `1756300000000`

### What was built
- **`LedgerCheckpointEntity`**: new `ledger_checkpoints` table storing
  `streamKey`, `ledgerSequence`, `ledgerHash`, `isCanonical` per stream.
- **`LedgerCheckpointService.validateAndSave`**: saves a checkpoint with
  optional hash validation. On hash mismatch triggers full reorg rewind.
- **`LedgerCheckpointService.detectAndRewind`**: compares stored hash at
  sequence N against incoming hash. Mismatch → atomic rewind to N-1, marks
  old checkpoint non-canonical, resumes ingestion from canonical branch.
- **`LedgerCheckpointService.atomicRewind`**: wraps all orphan writes in a
  single `SERIALIZABLE` PostgreSQL QueryRunner transaction — either everything
  reverts or nothing does.
- **`CallEventStoreService.handleReorg`**: upgraded from direct `save` to an
  atomic QueryRunner transaction for the orphan batch.
- **`CallEventStoreService.rewindToLedger`**: new method for range-based
  rewind via `SERIALIZABLE` QueryRunner UPDATE.
- In-memory fallback maintained; cursor is strictly monotonic (never rewinds).

### Tests added
`ledger-checkpoint.service.spec.ts` — load/save, detectAndRewind (match/mismatch/
different-sequence), atomicRewind rollback, monotonicity guard.  
`call-event-store.service.spec.ts` — idempotent upsert, handleReorg atomic
batch, rewindToLedger rollback, always-release QueryRunner.

---

## BE-003 · Multi-Outcome Event Ingestion Pipeline

**Branch**: `feature/be-003-multi-outcome-event-ingest`  
**Files**: `multi-outcome-event.service.ts`, `outcome-pool.entity.ts`,
`participant-stake.entity.ts`, migration `1756310000000`

### What was built
- **`MultiOutcomeEventService`**: typed handlers for all 4 Soroban event types:
  - `CallCreated` — upserts `Call` row + creates one `OutcomePool` per outcome
    slot (up to 32 per Soroban contract constraint).
  - `StakeAdded` — BigInt pool balance update (`totalStake += amount`),
    `ParticipantStake` upsert (additive per wallet/outcome), raw event row.
  - `OutcomeSubmitted` — transitions call to `SETTLING`, records
    `winningOutcomeIndex` and `evidenceCid`.
  - `PayoutWithdrawn` — persists payout event row.
- Every handler is wrapped in a QueryRunner transaction (atomic commit/rollback).
- **All monetary values stored as `DECIMAL(36,0)` strings** — BigInt arithmetic
  throughout, zero precision loss on I128-range amounts.
- **`OutcomePool`** entity: `totalStake`, `participantCount`, `outcomeLabel`,
  `ledgerHeight`, `blockHash`, `isOrphaned`.
- **`ParticipantStake`** entity: unique constraint on
  `(chain, callOnchainId, wallet, outcomeIndex)`.
- Payload extractors tolerate both flat-key and nested `value` SCVal map layouts.
- `StellarIndexerService` now dispatches to `MultiOutcomeEventService` after
  each successful `upsertEvent`.
- Emits domain events (`multiOutcome.CallCreated` etc.) post-commit.

### Tests added
`multi-outcome-event.service.spec.ts` — all event types, BigInt precision,
>32 outcomes rejection, rollback on DB failure, unknown event skip.

---

## BE-004 · Stellar Ledger Checkpoint Resumption with Redis Distributed Lock

**Branch**: `feature/be-004-indexer-distributed-lock`  
**Files**: `indexer-lock.service.ts`, `redis.config.ts`,
`health.controller.ts`, `health.module.ts`, `indexer.module.ts`,
`docker-compose.yml`, `.env.example`

### What was built
- **`IndexerLockService`**: Redlock-style distributed exclusive lock.
  - `acquire()`: `SET key <token> NX PX 10000` — only one replica wins.
  - `renew()`: `PEXPIRE key 10000` every 5s (TTL/2) — continuous leadership.
  - `release()`: Lua token-matched `DEL` — never deletes another replica's lock.
  - `tryAcquireLoop()`: retries every 1s when standby; seamless failover in <15s.
  - `onBecomeLeader` / `onLoseLeadership` callbacks.
  - `onModuleDestroy`: clears timers and releases lock cleanly.
- **`RedisClientProvider`**: tries ioredis → `@keyv/redis` adapter →
  `InProcessRedisStub` (in-memory fallback, single-replica safe).
- **`StellarIndexerService`**: skips poll cycle when `!lockService.isCurrentLeader()`
  — prevents dual indexing across replicas.
- **`GET /health/indexer`**: returns `{ status: 'leader'|'standby'|'unavailable',
  isLeader, lockTtlMs, acquireRetryMs }`.
- `docker-compose.yml`: added Redis 7 Alpine service.
- `.env.example`: documented `REDIS_URL` and lock behaviour.

### Tests added
`indexer-lock.service.spec.ts` — acquire success/failure/error, renew
step-down, Lua release, onBecomeLeader callback, destroy cleanup, standby
retry with fake timers, getStatus.

---

## What was tested

All 4 task implementations come with dedicated `*.spec.ts` unit test suites
covering happy paths, error recovery, transaction rollback, and edge cases.
Run with:

```bash
cd packages/backend
npx jest --testPathPattern="stellar-indexer|ledger-checkpoint|call-event-store|multi-outcome|indexer-lock" --no-coverage
```

## No breaking changes

- Existing `Call` entity and `calls` table are backward-compatible (new columns
  added via migrations with `ifNotExists` guards).
- `LedgerCheckpointService` still satisfies the `LedgerCheckpointStore`
  interface consumed by `StellarIndexerService` — no caller changes needed.
- `IndexerLockService` is `@Optional()` in `StellarIndexerService` — the
  service still works without Redis in local/dev environments.
