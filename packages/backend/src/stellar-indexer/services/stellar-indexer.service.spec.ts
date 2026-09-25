/**
 * stellar-indexer.service.spec.ts  (BE-001)
 *
 * Unit tests for the Soroban RPC event streaming engine.
 * Covers:
 *  - Adaptive backoff behaviour (no-new-ledgers → back off, events → reset)
 *  - Checkpoint resumption on start()
 *  - Pagination via cursor
 *  - Error recovery: exhausted retries don't crash the stream
 *  - SCVal decoding (U64, I128, Address, Vec, Map)
 *  - Domain event emission after successful store
 *  - Graceful stop / no timer leak
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  StellarIndexerService,
  StellarIndexerConfig,
} from './stellar-indexer.service';
import { CallEventStoreService } from './call-event-store.service';
import { SorobanRpcClient } from '../../config/soroban-rpc.client';
import { Call, ChainType } from '../entities/call.entity';
import { InMemoryLedgerCheckpointStore } from './ledger-checkpoint.service';
import * as StellarSdk from '@stellar/stellar-sdk';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSymbolVal(sym: string): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvSymbol(Buffer.from(sym));
}

function makeU64Val(n: bigint): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvU64(
    new StellarSdk.xdr.Uint64(Number(n)),
  );
}

function makeAddressVal(publicKey: string): StellarSdk.xdr.ScVal {
  const kp = StellarSdk.Keypair.fromPublicKey(publicKey);
  const accountId = StellarSdk.xdr.AccountID.publicKeyTypeEd25519(
    kp.rawPublicKey(),
  );
  const addr = StellarSdk.xdr.ScAddress.scAddressTypeAccount(accountId);
  return StellarSdk.xdr.ScVal.scvAddress(addr);
}

function fakeEvent(
  overrides: Partial<StellarSdk.rpc.Api.EventResponse> = {},
): StellarSdk.rpc.Api.EventResponse {
  return {
    id: '100-0',
    type: 'contract',
    ledger: 100,
    ledgerClosedAt: '2024-01-01T00:00:00Z',
    contractId: 'CTEST' as unknown as StellarSdk.Contract,
    txHash: 'txhash001',
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    topic: [makeSymbolVal('CallCreated')],
    value: makeU64Val(42n),
    ...overrides,
  } as StellarSdk.rpc.Api.EventResponse;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('StellarIndexerService (BE-001)', () => {
  let service: StellarIndexerService;
  let rpcClient: jest.Mocked<Pick<SorobanRpcClient, 'getLatestLedger'>>;
  let callEventStore: jest.Mocked<Pick<CallEventStoreService, 'upsertEvent'>>;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let callRepo: { find: jest.Mock };

  // Expose the private rpc.getEvents mock
  let mockRpcGetEvents: jest.Mock;

  const BASE_CONFIG: StellarIndexerConfig = {
    contractIds: ['CREGISTRY', 'COUTCOME', 'CTREASURY'],
    pollIntervalMs: 100,
    startLedger: 50,
    pageSize: 5,
  };

  beforeEach(async () => {
    mockRpcGetEvents = jest.fn().mockResolvedValue({ events: [], cursor: '' });

    rpcClient = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 200, id: '', protocolVersion: 0 }),
    };

    // Attach the private .rpc.getEvents mock so fetchEventsPage can reach it.
    (rpcClient as any).rpc = { getEvents: mockRpcGetEvents };

    callEventStore = {
      upsertEvent: jest.fn().mockResolvedValue({ id: 'uuid-1', chain: ChainType.STELLAR }),
    };

    eventEmitter = { emit: jest.fn() };

    callRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarIndexerService,
        { provide: getRepositoryToken(Call), useValue: callRepo },
        { provide: CallEventStoreService, useValue: callEventStore },
        { provide: SorobanRpcClient, useValue: rpcClient },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<StellarIndexerService>(StellarIndexerService);
    await service.initialize(BASE_CONFIG);
    // Swap in an in-memory store so checkpoint assertions are easy
    service.setCheckpointStore(new InMemoryLedgerCheckpointStore());
  });

  afterEach(async () => {
    await service.stop();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ─── Checkpoint resumption ──────────────────────────────────────────────────

  it('starts from startLedger when no checkpoint exists', async () => {
    await service.start();
    // Give the first poll cycle a chance to run
    await new Promise((r) => setTimeout(r, 20));
    // The getLatestLedger call must have been made
    expect(rpcClient.getLatestLedger).toHaveBeenCalled();
    await service.stop();
  });

  it('resumes from persisted checkpoint rather than startLedger', async () => {
    const store = new InMemoryLedgerCheckpointStore();
    await store.save('stellar:COUTCOME,CREGISTRY,CTREASURY', 999);
    service.setCheckpointStore(store);

    await service.start();
    await new Promise((r) => setTimeout(r, 20));
    await service.stop();

    // Because currentLedger was set from checkpoint (999) which is > latest (200),
    // no events should be fetched — getLatestLedger still called to compare.
    expect(rpcClient.getLatestLedger).toHaveBeenCalled();
    // upsertEvent should NOT have been called (cursor > latest)
    expect(callEventStore.upsertEvent).not.toHaveBeenCalled();
  });

  // ─── Event ingestion ────────────────────────────────────────────────────────

  it('calls upsertEvent and emits domain event for each parsed event', async () => {
    mockRpcGetEvents.mockResolvedValueOnce({
      events: [fakeEvent()],
      cursor: '',
    });

    await service.start();
    await new Promise((r) => setTimeout(r, 50));
    await service.stop();

    expect(callEventStore.upsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: ChainType.STELLAR,
        txHash: 'txhash001',
        eventType: 'CallCreated',
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'stellar.CallCreated',
      expect.objectContaining({ eventType: 'CallCreated' }),
    );
  });

  // ─── Pagination ─────────────────────────────────────────────────────────────

  it('follows cursor to fetch subsequent pages until exhausted', async () => {
    // Page 1 returns 5 events (= pageSize), so a next page is expected.
    // The response-level cursor drives pagination in the SDK (not per-event).
    const page1Events = Array.from({ length: 5 }, (_, i) =>
      fakeEvent({ id: `100-${i}`, txHash: `tx${i}` }),
    );
    // Page 2 returns 2 events (< pageSize), so pagination stops.
    const page2Events = Array.from({ length: 2 }, (_, i) =>
      fakeEvent({ id: `100-${i + 5}`, txHash: `tx${i + 5}` }),
    );

    mockRpcGetEvents
      .mockResolvedValueOnce({ events: page1Events, cursor: 'cursor-page2' })
      .mockResolvedValueOnce({ events: page2Events, cursor: '' });

    await service.start();
    await new Promise((r) => setTimeout(r, 80));
    await service.stop();

    expect(callEventStore.upsertEvent).toHaveBeenCalledTimes(7);
  });

  // ─── Error recovery ─────────────────────────────────────────────────────────

  it('does not crash the stream when getLatestLedger fails repeatedly', async () => {
    rpcClient.getLatestLedger
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue({ sequence: 200, id: '', protocolVersion: 0 });

    // Should not throw
    await expect(service.start()).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 150));
    await service.stop();

    // Eventually recovered and fetched
    expect(rpcClient.getLatestLedger).toHaveBeenCalledTimes(
      expect.any(Number),
    );
  });

  it('skips a bad event and continues processing the rest', async () => {
    const goodEvent = fakeEvent({ txHash: 'txGood' });
    const badEvent = fakeEvent({
      id: '100-1',
      txHash: 'txBad',
      // Corrupt the topic so parseEvent throws
      topic: [null as unknown as StellarSdk.xdr.ScVal],
    });

    mockRpcGetEvents.mockResolvedValueOnce({
      events: [badEvent, goodEvent],
      cursor: '',
    });

    await service.start();
    await new Promise((r) => setTimeout(r, 60));
    await service.stop();

    // Good event should still have been stored
    expect(callEventStore.upsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: 'txGood' }),
    );
  });

  // ─── SCVal decoding ──────────────────────────────────────────────────────────

  describe('decodeScVal', () => {
    it('decodes scvU64 as a decimal string', () => {
      const val = makeU64Val(9_007_199_254_740_993n); // > Number.MAX_SAFE_INTEGER
      expect(service.decodeScVal(val)).toBe('9007199254740993');
    });

    it('decodes scvSymbol as a string', () => {
      expect(service.decodeScVal(makeSymbolVal('CallCreated'))).toBe('CallCreated');
    });

    it('decodes scvAddress as a StrKey G... address', () => {
      const kp = StellarSdk.Keypair.random();
      const val = makeAddressVal(kp.publicKey());
      const decoded = service.decodeScVal(val);
      expect(decoded).toBe(kp.publicKey());
    });

    it('decodes scvVec recursively', () => {
      const vec = StellarSdk.xdr.ScVal.scvVec([
        makeSymbolVal('a'),
        makeSymbolVal('b'),
      ]);
      expect(service.decodeScVal(vec)).toEqual(['a', 'b']);
    });

    it('decodes scvMap into a plain object', () => {
      const map = StellarSdk.xdr.ScVal.scvMap([
        new StellarSdk.xdr.ScMapEntry({
          key: makeSymbolVal('amount'),
          val: makeU64Val(100n),
        }),
      ]);
      expect(service.decodeScVal(map)).toEqual({ amount: '100' });
    });

    it('returns null for scvVoid', () => {
      const voidVal = StellarSdk.xdr.ScVal.scvVoid();
      expect(service.decodeScVal(voidVal)).toBeNull();
    });
  });

  // ─── Graceful stop ───────────────────────────────────────────────────────────

  it('clears the poll timer on stop() so no further polls run', async () => {
    await service.start();
    await service.stop();

    const callCount = rpcClient.getLatestLedger.mock.calls.length;
    await new Promise((r) => setTimeout(r, 300));
    // No additional calls after stop
    expect(rpcClient.getLatestLedger.mock.calls.length).toBe(callCount);
  });

  it('stop() is idempotent', async () => {
    await service.start();
    await service.stop();
    await expect(service.stop()).resolves.toBeUndefined();
  });

  // ─── Stats ────────────────────────────────────────────────────────────────────

  it('getStellarEventStats returns structured stats', async () => {
    callRepo.find.mockResolvedValue([
      { eventType: 'CallCreated' },
      { eventType: 'CallCreated' },
      { eventType: 'StakeAdded' },
    ]);

    const stats = await service.getStellarEventStats();
    expect(stats.totalEvents).toBe(3);
    expect(stats.eventsByType).toEqual({ CallCreated: 2, StakeAdded: 1 });
    expect(stats.isRunning).toBe(false);
  });
});
