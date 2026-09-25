/**
 * stellar-indexer.service.ts  (BE-001)
 *
 * Resilient Soroban RPC event polling engine.
 *
 * Features:
 *  - Polls getEvents() across call_registry, outcome_manager, and treasury
 *    contract addresses with configurable startLedger pagination.
 *  - Exponential backoff with jitter and a hard cap on delays (via
 *    withRetry from rpc-retry.util) — recovers automatically from network
 *    partitions, rate-limits, and transient 5xx errors.
 *  - Adaptive polling interval: backs off when no new ledgers are available
 *    and speeds back up as events flow in.
 *  - Persists a checkpoint cursor per stream so restarts resume exactly
 *    from the last committed ledger (no gaps, no re-scans).
 *  - Uses the SorobanRpcClient (@Global injectable) instead of instantiating
 *    its own rpc.Server — the single shared client already carries
 *    @Retryable() on all its methods.
 *  - Emits NestJS domain events (EventEmitter2) after each successfully
 *    stored on-chain event for downstream consumers (badges, analytics…).
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as StellarSdk from '@stellar/stellar-sdk';

import { Call, ChainType } from '../entities/call.entity';
import {
  LedgerCheckpointStore,
  InMemoryLedgerCheckpointStore,
} from './ledger-checkpoint.service';
import { CallEventStoreService } from './call-event-store.service';
import { MultiOutcomeEventService } from './multi-outcome-event.service';
import { IndexerLockService } from './indexer-lock.service';
import { SorobanRpcClient } from '../../config/soroban-rpc.client';
import {
  withRetry,
  defaultSorobanIsRetryable,
} from '../../common/rpc/rpc-retry.util';

// ─── Public config / event types ──────────────────────────────────────────────

export interface StellarIndexerConfig {
  rpcUrl?: string; // unused (SorobanRpcClient is injected globally) — kept for back-compat
  /** Contract addresses to watch. Typically: call_registry, outcome_manager, treasury. */
  contractIds: string[];
  /** Base polling interval in milliseconds (default: 6 000 ms ≈ half a Stellar ledger). */
  pollIntervalMs?: number;
  /** Ledger to start from. Falls back to latestLedger - 100 if omitted. */
  startLedger?: number;
  /** Max page size per getEvents request (default: 200). */
  pageSize?: number;
}

export interface ParsedSorobanEvent {
  type: string;
  contractId: string;
  ledger: number;
  txHash: string;
  sequence: number;
  /**
   * `ledgerClosedAt` is used as the reorg-detection cursor: if a ledger
   * at the same sequence ever closes differently after a reorg, the
   * timestamp changes and we detect the mismatch.
   */
  blockHash: string;
  data: Record<string, unknown>;
}

// Domain event names emitted via EventEmitter2 after successful persistence.
export const STELLAR_EVENT_NAMES = {
  CALL_CREATED: 'stellar.CallCreated',
  STAKE_ADDED: 'stellar.StakeAdded',
  OUTCOME_SUBMITTED: 'stellar.OutcomeSubmitted',
  PAYOUT_WITHDRAWN: 'stellar.PayoutWithdrawn',
} as const;

// ─── Adaptive backoff constants ───────────────────────────────────────────────

/** Minimum poll interval – don't poll faster than one ledger close time. */
const MIN_POLL_MS = 4_000;
/** Maximum poll interval – back off up to this after repeated empty polls. */
const MAX_POLL_MS = 60_000;
/** Multiply the interval by this factor each time we find no new ledgers. */
const BACKOFF_FACTOR = 1.5;
/** Reset the interval to this when events are found. */
const DEFAULT_POLL_MS = 6_000;

// ─── RPC retry settings for the streaming loop ───────────────────────────────

const STREAM_RETRY_OPTIONS = {
  maxAttempts: 8,
  baseDelayMs: 1_000,
  factor: 2,
  maxDelayMs: 30_000,
  jitter: 0.25,
  isRetryable: defaultSorobanIsRetryable,
  operationName: 'StellarIndexer:streamGetEvents',
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class StellarIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StellarIndexerService.name);

  // ── State ─────────────────────────────────────────────────────────────────
  private isRunning = false;
  private currentLedger = 0;
  private config: StellarIndexerConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private currentPollMs = DEFAULT_POLL_MS;

  private checkpointStore: LedgerCheckpointStore =
    new InMemoryLedgerCheckpointStore();

  constructor(
    @InjectRepository(Call)
    private readonly callRepository: Repository<Call>,
    private readonly callEventStore: CallEventStoreService,
    private readonly sorobanRpcClient: SorobanRpcClient,
    private readonly eventEmitter: EventEmitter2,
    private readonly multiOutcomeService: MultiOutcomeEventService,
    @Optional() private readonly lockService?: IndexerLockService,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    if (!this.config) {
      this.logger.warn(
        'StellarIndexerService: no config set — call initialize() to start streaming.',
      );
      return;
    }
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Inject a durable checkpoint store (TypeORM / Redis). Defaults to in-memory. */
  setCheckpointStore(store: LedgerCheckpointStore): void {
    this.checkpointStore = store;
  }

  async initialize(config: StellarIndexerConfig): Promise<void> {
    this.config = {
      pollIntervalMs: DEFAULT_POLL_MS,
      pageSize: 200,
      ...config,
    };
    this.currentPollMs = this.config.pollIntervalMs ?? DEFAULT_POLL_MS;

    this.logger.log(
      `StellarIndexerService initialised — contracts: [${this.config.contractIds.join(', ')}]`,
    );
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Stellar indexer is already running.');
      return;
    }

    // Resolve the starting ledger from: config override → persisted checkpoint
    // → (latestLedger - 100) so we don't miss recent events on first boot.
    const checkpoint = await this.checkpointStore.load(this.checkpointKey);
    if (checkpoint !== null) {
      this.currentLedger = checkpoint;
      this.logger.log(
        `Resuming Stellar stream from checkpoint ledger ${checkpoint}.`,
      );
    } else if (this.config.startLedger) {
      this.currentLedger = this.config.startLedger;
      this.logger.log(
        `Starting Stellar stream from configured ledger ${this.currentLedger}.`,
      );
    } else {
      try {
        const latest = await this.sorobanRpcClient.getLatestLedger();
        this.currentLedger = Math.max(1, latest.sequence - 100);
        this.logger.log(
          `Starting Stellar stream from latest-100 ledger ${this.currentLedger} (latest=${latest.sequence}).`,
        );
      } catch (err) {
        this.logger.error(
          'Failed to fetch latest ledger on start — defaulting to ledger 1.',
          err,
        );
        this.currentLedger = 1;
      }
    }

    this.isRunning = true;
    this.logger.log('Stellar event stream started.');
    // Kick off the first poll immediately, then schedule subsequent ones.
    void this.pollCycle();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.log('Stellar event stream stopped.');
  }

  // ── Streaming loop ─────────────────────────────────────────────────────────

  /**
   * Core polling cycle.
   *
   * Uses a recursive setTimeout (not setInterval) so the next tick only
   * begins after the current one is fully complete — preventing overlapping
   * requests under slow RPCs or large backlogs.
   *
   * The adaptive interval:
   *  - Doubles (up to MAX_POLL_MS) when there are no new ledgers (RPC
   *    ahead-of-chain condition or network partition recovery).
   *  - Resets to DEFAULT_POLL_MS the moment events are ingested.
   */
  private async pollCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Guard: only process events when this pod holds the distributed lock.
      // If no lock service is configured (e.g. local dev), always proceed.
      if (this.lockService && !this.lockService.isCurrentLeader()) {
        this.logger.debug('Not the indexer leader — skipping poll cycle.');
        // Schedule next tick and return — do not fetch
        if (this.isRunning) {
          this.pollTimer = setTimeout(() => void this.pollCycle(), MIN_POLL_MS);
        }
        return;
      }

      const advanced = await this.fetchAndProcessEvents();
      // Adaptive interval
      if (advanced) {
        this.currentPollMs = this.config.pollIntervalMs ?? DEFAULT_POLL_MS;
      } else {
        this.currentPollMs = Math.min(
          Math.round(this.currentPollMs * BACKOFF_FACTOR),
          MAX_POLL_MS,
        );
        this.logger.debug(
          `No new ledgers — backing off poll to ${this.currentPollMs}ms.`,
        );
      }
    } catch (err) {
      // The inner withRetry exhausted all attempts; log and continue the
      // stream — the next tick will try again from the same ledger.
      this.logger.error(
        `Stellar stream cycle failed (ledger ${this.currentLedger}). Will retry on next tick.`,
        err,
      );
      this.currentPollMs = Math.min(
        Math.round(this.currentPollMs * BACKOFF_FACTOR),
        MAX_POLL_MS,
      );
    }

    if (!this.isRunning) return;

    this.pollTimer = setTimeout(() => {
      void this.pollCycle();
    }, Math.max(this.currentPollMs, MIN_POLL_MS));
  }

  /**
   * Fetches all events from `currentLedger` up to `latestLedger`, paging
   * through the cursor if needed, then advances the checkpoint.
   *
   * Returns `true` if the ledger cursor advanced (i.e. new ledgers existed).
   */
  private async fetchAndProcessEvents(): Promise<boolean> {
    const latestLedger = await withRetry(
      () => this.sorobanRpcClient.getLatestLedger(),
      { ...STREAM_RETRY_OPTIONS, operationName: 'StellarIndexer:getLatestLedger' },
    );
    const toLedger = latestLedger.sequence;

    if (this.currentLedger > toLedger) {
      this.logger.debug(
        `Ledger cursor (${this.currentLedger}) is at or ahead of latest (${toLedger}) — waiting.`,
      );
      return false;
    }

    this.logger.debug(
      `Polling ledgers ${this.currentLedger}–${toLedger} across ${this.config.contractIds.length} contract(s).`,
    );

    // Fetch all contracts in a single RPC call using multiple filters (one
    // per contract). This halves network round-trips vs per-contract loops.
    let processedCount = 0;
    let cursor: string | undefined;

    do {
      const page = await withRetry(
        () =>
          this.fetchEventsPage(this.currentLedger, this.config.contractIds, cursor),
        STREAM_RETRY_OPTIONS,
      );

      for (const raw of page.events) {
        try {
          const parsed = this.parseEvent(raw);
          await this.storeAndEmit(parsed);
          processedCount++;
        } catch (parseErr) {
          this.logger.error(
            `Failed to parse/store event id=${raw.id} — skipping.`,
            parseErr,
          );
        }
      }

      cursor = page.cursor;
    } while (cursor);

    if (processedCount > 0) {
      this.logger.log(
        `Ingested ${processedCount} event(s) from ledgers ${this.currentLedger}–${toLedger}.`,
      );
    }

    // Advance cursor and persist checkpoint.
    this.currentLedger = toLedger + 1;
    await this.checkpointStore.save(this.checkpointKey, this.currentLedger);

    return true;
  }

  /**
   * One paginated getEvents call.
   * Returns raw events and an optional cursor for the next page.
   *
   * The SDK's GetEventsResponse carries a top-level `cursor` string.
   * When the returned cursor is non-empty, there are more pages to fetch.
   * Individual EventResponse objects do NOT expose a pagingToken field.
   */
  private async fetchEventsPage(
    startLedger: number,
    contractIds: string[],
    cursor?: string,
  ): Promise<{ events: StellarSdk.rpc.Api.EventResponse[]; cursor?: string }> {
    const filters: StellarSdk.rpc.Api.EventFilter[] = contractIds.map((id) => ({
      type: 'contract' as const,
      contractIds: [id],
    }));

    // GetEventsRequest is a discriminated union: startLedger and cursor are
    // mutually exclusive (cursor?: never in the startLedger branch).
    const requestParams: StellarSdk.rpc.Api.GetEventsRequest = cursor
      ? { filters, limit: this.config.pageSize ?? 200, cursor }
      : { startLedger, filters, limit: this.config.pageSize ?? 200 };

    const response = await (
      this.sorobanRpcClient as unknown as {
        rpc: {
          getEvents: (
            p: StellarSdk.rpc.Api.GetEventsRequest,
          ) => Promise<StellarSdk.rpc.Api.GetEventsResponse>;
        };
      }
    ).rpc.getEvents(requestParams);

    const events = response.events ?? [];
    const pageSize = this.config.pageSize ?? 200;

    // The response cursor advances only when a full page was returned.
    // An empty or partial page means we have reached the end.
    const nextCursor =
      events.length === pageSize && response.cursor
        ? response.cursor
        : undefined;

    return { events, cursor: nextCursor };
  }

  // ── Event parsing ──────────────────────────────────────────────────────────

  private parseEvent(
    event: StellarSdk.rpc.Api.EventResponse,
  ): ParsedSorobanEvent {
    const topics: StellarSdk.xdr.ScVal[] = event.topic;
    const value: StellarSdk.xdr.ScVal = event.value;

    const eventType = this.extractEventType(topics);
    const data = this.decodePayload(topics, value);

    // event.id format: "<ledgerSeq>-<eventIndex>"
    const parts = event.id.split('-');
    const sequence = parts[1] ? parseInt(parts[1], 10) : 0;

    return {
      type: eventType,
      contractId: event.contractId ? event.contractId.toString() : '',
      ledger: event.ledger,
      txHash: event.txHash,
      sequence,
      blockHash: event.ledgerClosedAt, // timestamp fingerprint as reorg cursor
      data,
    };
  }

  private extractEventType(topics: StellarSdk.xdr.ScVal[]): string {
    if (topics.length === 0) return 'Unknown';
    const first = topics[0];
    if (first.switch() === StellarSdk.xdr.ScValType.scvSymbol()) {
      return this.normaliseEventName(first.sym().toString());
    }
    return 'Unknown';
  }

  private normaliseEventName(raw: string): string {
    const MAP: Record<string, string> = {
      call_created: 'CallCreated',
      CallCreated: 'CallCreated',
      stake_added: 'StakeAdded',
      StakeAdded: 'StakeAdded',
      outcome_submitted: 'OutcomeSubmitted',
      OutcomeSubmitted: 'OutcomeSubmitted',
      payout_withdrawn: 'PayoutWithdrawn',
      PayoutWithdrawn: 'PayoutWithdrawn',
    };
    return MAP[raw] ?? raw;
  }

  /**
   * Decodes all topics (skipping index 0 which is the event name) plus the
   * value blob into a plain JS object. All currency amounts are preserved as
   * decimal strings to avoid JS Number precision loss.
   */
  private decodePayload(
    topics: StellarSdk.xdr.ScVal[],
    value: StellarSdk.xdr.ScVal,
  ): Record<string, unknown> {
    const decoded: Record<string, unknown> = {};
    for (let i = 1; i < topics.length; i++) {
      decoded[`topic_${i}`] = this.decodeScVal(topics[i]);
    }
    decoded['value'] = this.decodeScVal(value);
    return decoded;
  }

  /**
   * Recursive SCVal decoder.
   *
   * Integers (U64 / I64 / I128 / U128) are returned as decimal strings to
   * preserve full precision — JavaScript Number can only safely represent
   * integers up to 2^53.
   */
  decodeScVal(scVal: StellarSdk.xdr.ScVal): unknown {
    const type = scVal.switch();

    switch (type) {
      case StellarSdk.xdr.ScValType.scvBool():
        return scVal.b();

      case StellarSdk.xdr.ScValType.scvU32():
        return scVal.u32();

      case StellarSdk.xdr.ScValType.scvI32():
        return scVal.i32();

      case StellarSdk.xdr.ScValType.scvU64():
        return scVal.u64().toString();

      case StellarSdk.xdr.ScValType.scvI64():
        return scVal.i64().toString();

      case StellarSdk.xdr.ScValType.scvU128(): {
        const u128 = scVal.u128();
        const hi = BigInt(u128.hi().toString());
        const lo = BigInt(u128.lo().toString());
        return ((hi << 64n) | lo).toString();
      }

      case StellarSdk.xdr.ScValType.scvI128(): {
        const i128 = scVal.i128();
        const hi = BigInt(i128.hi().toString());
        const lo = BigInt(i128.lo().toString());
        return ((hi << 64n) | lo).toString();
      }

      case StellarSdk.xdr.ScValType.scvSymbol():
        return scVal.sym().toString();

      case StellarSdk.xdr.ScValType.scvString():
        return scVal.str().toString();

      case StellarSdk.xdr.ScValType.scvBytes():
        return (scVal.bytes() as Buffer).toString('hex');

      case StellarSdk.xdr.ScValType.scvAddress(): {
        const addr = scVal.address();
        const addrType = addr.switch();
        if (addrType === StellarSdk.xdr.ScAddressType.scAddressTypeAccount()) {
          return StellarSdk.StrKey.encodeEd25519PublicKey(
            Buffer.from(addr.accountId().ed25519()),
          );
        }
        return StellarSdk.StrKey.encodeContract(
          addr.contractId() as unknown as Buffer,
        );
      }

      case StellarSdk.xdr.ScValType.scvVec(): {
        const vec = scVal.vec();
        return vec ? vec.map((v) => this.decodeScVal(v)) : [];
      }

      case StellarSdk.xdr.ScValType.scvMap(): {
        const result: Record<string, unknown> = {};
        const entries = scVal.map();
        if (entries) {
          for (const entry of entries) {
            const key = String(this.decodeScVal(entry.key()));
            result[key] = this.decodeScVal(entry.val());
          }
        }
        return result;
      }

      case StellarSdk.xdr.ScValType.scvVoid():
        return null;

      default:
        // For unrecognised types return null rather than throwing — the
        // stream should not crash on unknown future SCVal variants.
        this.logger.debug(`Unrecognised SCVal type: ${type.name}`);
        return null;
    }
  }

  // ── Persistence & domain events ────────────────────────────────────────────

  private async storeAndEmit(event: ParsedSorobanEvent): Promise<void> {
    const stored = await this.callEventStore.upsertEvent({
      chain: ChainType.STELLAR,
      txHash: event.txHash,
      eventType: event.type,
      contractId: event.contractId,
      stellarContractId: event.contractId,
      eventSequence: event.sequence,
      ledgerHeight: event.ledger,
      blockHash: event.blockHash,
      eventData: event.data,
    });

    this.logger.debug(
      `Stored ${event.type} from ${event.contractId} @ ledger ${event.ledger} (id=${stored.id}).`,
    );

    // Dispatch to the multi-outcome pipeline for relational entity writes.
    await this.multiOutcomeService.handleEvent(event);

    // Emit typed NestJS domain event for downstream consumers.
    const domainEventName =
      STELLAR_EVENT_NAMES[event.type as keyof typeof STELLAR_EVENT_NAMES] ??
      `stellar.${event.type}`;

    this.eventEmitter.emit(domainEventName, {
      callId: stored.id,
      eventType: event.type,
      contractId: event.contractId,
      ledger: event.ledger,
      txHash: event.txHash,
      data: event.data,
    });
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  private get checkpointKey(): string {
    return `stellar:${[...this.config.contractIds].sort().join(',')}`;
  }

  // ── Query helpers (used by IndexerController) ─────────────────────────────

  async getEventsByType(eventType: string): Promise<Call[]> {
    return this.callRepository.find({
      where: { chain: ChainType.STELLAR, eventType },
      order: { createdAt: 'DESC' },
    });
  }

  async getEventsByContract(contractId: string): Promise<Call[]> {
    return this.callRepository.find({
      where: { chain: ChainType.STELLAR, contractId },
      order: { ledgerHeight: 'DESC' },
    });
  }

  async getStellarEventStats(): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    lastIndexedLedger: number;
    isRunning: boolean;
    currentPollIntervalMs: number;
  }> {
    const events = await this.callRepository.find({
      where: { chain: ChainType.STELLAR, isOrphaned: false },
    });

    const eventsByType: Record<string, number> = {};
    for (const e of events) {
      eventsByType[e.eventType] = (eventsByType[e.eventType] ?? 0) + 1;
    }

    return {
      totalEvents: events.length,
      eventsByType,
      lastIndexedLedger: this.currentLedger,
      isRunning: this.isRunning,
      currentPollIntervalMs: this.currentPollMs,
    };
  }
}
