import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Call, ChainType } from '../entities/call.entity';
import {
  BulkEventLoaderService,
  BULK_EVENT_WRITER,
} from './bulk-event-loader.service';
import type { BulkEventWriter } from './bulk-event-loader.service';
import { CallEventStoreService } from './call-event-store.service';
import type {
  BulkUpsertResult,
  UpsertCallEventInput,
} from './call-event-store.service';
import type { BulkIngestConfig } from '../../config/bulk-ingest.config';

/**
 * BE-008 — BulkEventLoaderService.
 *
 * The loader's whole job is coordinating time and batching, so most of these
 * tests drive the clock with fake timers and assert on the write boundary
 * (what reached the writer, in how many calls) rather than on internals.
 */
describe('BulkEventLoaderService (BE-008)', () => {
  let service: BulkEventLoaderService;
  let writer: { bulkUpsertEvents: jest.Mock };
  let config: { get: jest.Mock };

  const DEFAULT_CONFIG: BulkIngestConfig = {
    batchSize: 5_000,
    maxLatencyMs: 500,
    maxRowsPerStatement: 1_000,
    maxConcurrency: 2,
    maxRetries: 3,
    retryDelayMs: 250,
  };

  const ok = (inserted: number, duplicates = 0): BulkUpsertResult => ({
    attempted: inserted + duplicates,
    deduplicated: 0,
    inserted,
    duplicatesSkipped: duplicates,
    statements: 1,
    durationMs: 1,
    throughputPerSecond: inserted * 1000,
  });

  const event = (over: Partial<UpsertCallEventInput> = {}): UpsertCallEventInput => ({
    chain: ChainType.STELLAR,
    txHash: 'tx-1',
    eventType: 'CallCreated',
    eventSequence: 0,
    ledgerHeight: 100,
    ...over,
  });

  /** Batches handed to the writer, in order. */
  const batches = (): UpsertCallEventInput[][] =>
    writer.bulkUpsertEvents.mock.calls.map((call) => call[0]);

  beforeEach(() => {
    jest.useFakeTimers();
    writer = { bulkUpsertEvents: jest.fn().mockResolvedValue(ok(1)) };
    config = { get: jest.fn().mockReturnValue(DEFAULT_CONFIG) };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const build = async (
    overrides: Partial<BulkIngestConfig> = {},
  ): Promise<void> => {
    if (Object.keys(overrides).length > 0) {
      config.get.mockReturnValue({ ...DEFAULT_CONFIG, ...overrides });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkEventLoaderService,
        { provide: ConfigService, useValue: config },
        { provide: BULK_EVENT_WRITER, useValue: writer },
      ],
    }).compile();

    service = module.get<BulkEventLoaderService>(BulkEventLoaderService);
    service.onModuleInit();
  };

  describe('batching triggers', () => {
    it('does not flush a partial batch before the latency window elapses', async () => {
      await build();
      service.enqueue(event({ eventSequence: 1 }));

      jest.advanceTimersByTime(499);
      expect(writer.bulkUpsertEvents).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await jest.advanceTimersByTimeAsync(0);
      expect(writer.bulkUpsertEvents).toHaveBeenCalledTimes(1);
    });

    it('flushes immediately once the buffer reaches batchSize, without waiting for the timer', async () => {
      await build({ batchSize: 3, maxLatencyMs: 60_000 });

      service.enqueue(event({ eventSequence: 1 }));
      service.enqueue(event({ eventSequence: 2 }));
      expect(writer.bulkUpsertEvents).not.toHaveBeenCalled();

      service.enqueue(event({ eventSequence: 3 }));
      await jest.advanceTimersByTimeAsync(0);

      expect(writer.bulkUpsertEvents).toHaveBeenCalledTimes(1);
      expect(batches()[0]).toHaveLength(3);
    });

    it('measures the latency window from the oldest buffered event, not the newest', async () => {
      await build({ batchSize: 1_000, maxLatencyMs: 500 });

      service.enqueue(event({ eventSequence: 1 }));
      jest.advanceTimersByTime(400);

      // A late arrival must not push the deadline out for the event that has
      // already been waiting 400ms.
      service.enqueue(event({ eventSequence: 2 }));
      jest.advanceTimersByTime(100);
      await jest.advanceTimersByTimeAsync(0);

      expect(writer.bulkUpsertEvents).toHaveBeenCalledTimes(1);
      expect(batches()[0]).toHaveLength(2);
    });

    it('divides a large enqueue into full batches', async () => {
      await build({ batchSize: 100, maxLatencyMs: 60_000 });
      writer.bulkUpsertEvents.mockResolvedValue(ok(100));

      service.enqueueMany(
        Array.from({ length: 250 }, (_, i) => event({ eventSequence: i })),
      );
      await jest.advanceTimersByTimeAsync(0);

      // Two full batches flushed; the 50-event remainder waits for the latency
      // trigger rather than being written as an undersized third batch.
      expect(batches().map((b) => b.length)).toEqual([100, 100]);
      expect(service.getStats().buffered).toBe(50);
    });
  });

  describe('flush()', () => {
    it('writes everything buffered and reports the result', async () => {
      await build();
      const result = { ...ok(2, 1), attempted: 3 };
      writer.bulkUpsertEvents.mockResolvedValue(result);

      service.enqueue(event({ eventSequence: 1 }));
      service.enqueue(event({ eventSequence: 2 }));
      service.enqueue(event({ eventSequence: 3 }));

      await expect(service.flush()).resolves.toEqual(result);
      expect(batches()[0]).toHaveLength(3);
      expect(service.isFlushing()).toBe(false);
    });

    it('resolves to null when there is nothing buffered', async () => {
      await build();
      await expect(service.flush()).resolves.toBeNull();
      expect(writer.bulkUpsertEvents).not.toHaveBeenCalled();
    });

    it('keeps events enqueued during a flush for the following one', async () => {
      await build({ batchSize: 1_000, maxLatencyMs: 60_000 });

      let releaseFirst: (value: BulkUpsertResult) => void = () => undefined;
      writer.bulkUpsertEvents.mockImplementationOnce(
        () =>
          new Promise<BulkUpsertResult>((resolve) => {
            releaseFirst = resolve;
          }),
      );

      service.enqueue(event({ eventSequence: 1 }));
      const firstFlush = service.flush();

      // The buffer was swapped out before the write started, so these land in
      // the next batch rather than being lost or written twice.
      service.enqueue(event({ eventSequence: 2 }));
      service.enqueue(event({ eventSequence: 3 }));
      expect(service.getStats().buffered).toBe(2);

      // The write only starts once the flush chain reaches it, so give the
      // chain a turn before reaching for the handle the mock just captured.
      await jest.advanceTimersByTimeAsync(0);
      releaseFirst(ok(1));
      await firstFlush;
      expect(batches()[0].map((e) => e.eventSequence)).toEqual([1]);
      expect(service.getStats().buffered).toBe(2);
    });

    it('serialises concurrent flushes instead of racing on the buffer', async () => {
      await build({ batchSize: 1_000, maxLatencyMs: 60_000 });
      writer.bulkUpsertEvents.mockResolvedValue(ok(1));

      service.enqueue(event({ eventSequence: 1 }));

      const a = service.flush('a');
      const b = service.flush('b');
      const c = service.flush('c');
      await Promise.all([a, b, c]);

      // Three concurrent callers, one batch of one event — not three writes of
      // the same event and not an empty write.
      expect(writer.bulkUpsertEvents).toHaveBeenCalledTimes(1);
      expect(batches()[0]).toHaveLength(1);
    });

    it('drains events buffered while a chained flush was in flight', async () => {
      await build({ batchSize: 1_000, maxLatencyMs: 60_000 });

      let release: (value: BulkUpsertResult) => void = () => undefined;
      writer.bulkUpsertEvents.mockImplementationOnce(
        () =>
          new Promise<BulkUpsertResult>((resolve) => {
            release = resolve;
          }),
      );

      service.enqueue(event({ eventSequence: 1 }));
      const first = service.flush();
      service.enqueue(event({ eventSequence: 2 }));

      const chained = service.flush();
      await jest.advanceTimersByTimeAsync(0);
      release(ok(1));

      await first;
      await chained;

      // The second caller must not resolve with the buffer still non-empty.
      expect(service.getStats().buffered).toBe(0);
      expect(batches().flat().map((e) => e.eventSequence).sort()).toEqual([1, 2]);
    });
  });

  describe('ingest()', () => {
    it('buffers and writes in one call', async () => {
      await build();
      const result = { ...ok(3), attempted: 3 };
      writer.bulkUpsertEvents.mockResolvedValue(result);

      await expect(
        service.ingest([
          event({ eventSequence: 1 }),
          event({ eventSequence: 2 }),
          event({ eventSequence: 3 }),
        ]),
      ).resolves.toEqual(result);

      expect(batches()[0]).toHaveLength(3);
      expect(service.getStats().buffered).toBe(0);
    });
  });

  describe('failure handling', () => {
    it('logs and counts a failed write instead of throwing out of a timer flush', async () => {
      await build({ batchSize: 100, maxLatencyMs: 60_000 });
      writer.bulkUpsertEvents.mockRejectedValue(new Error('connection reset'));

      service.enqueue(event());
      await expect(service.flush()).resolves.toBeNull();

      expect(service.getStats().failedFlushes).toBe(1);
      // Buffer was already drained; the batch is idempotent and re-drivable.
      expect(service.getStats().buffered).toBe(0);
    });

    it('does not let a rejection escape the latency-triggered flush', async () => {
      await build({ batchSize: 1_000, maxLatencyMs: 100 });
      writer.bulkUpsertEvents.mockRejectedValue(new Error('deadlock detected'));

      service.enqueue(event());
      jest.advanceTimersByTime(100);
      await jest.advanceTimersByTimeAsync(0);

      expect(writer.bulkUpsertEvents).toHaveBeenCalled();
      expect(service.getStats().failedFlushes).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('flushes the tail on shutdown rather than discarding it', async () => {
      await build({ batchSize: 1_000, maxLatencyMs: 60_000 });
      service.enqueue(event({ eventSequence: 7 }));

      await service.onModuleDestroy();

      expect(batches()[0].map((e) => e.eventSequence)).toEqual([7]);
    });

    it('drops events enqueued after shutdown', async () => {
      await build({ batchSize: 1_000, maxLatencyMs: 60_000 });
      await service.onModuleDestroy();
      writer.bulkUpsertEvents.mockClear();

      service.enqueue(event({ eventSequence: 8 }));
      jest.advanceTimersByTime(60_000);
      await jest.advanceTimersByTimeAsync(0);

      expect(writer.bulkUpsertEvents).not.toHaveBeenCalled();
    });

    it('does not leave a timer armed that could keep the process alive', async () => {
      await build({ batchSize: 1_000, maxLatencyMs: 60_000 });
      service.enqueue(event());

      // unref() is what keeps a pending flush from holding the event loop open.
      expect(jest.getTimerCount()).toBe(1);
      await service.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('getStats()', () => {
    it('tracks enqueued, written and duplicate counters', async () => {
      // batchSize 3 so the three-event enqueue is exactly one batch and the
      // explicit flush below has nothing left to do.
      await build({ batchSize: 3, maxLatencyMs: 60_000 });
      writer.bulkUpsertEvents.mockResolvedValue(ok(1, 1));

      service.enqueueMany([
        event({ eventSequence: 1 }),
        event({ eventSequence: 2 }),
        event({ eventSequence: 3 }),
      ]);
      await service.flush();

      const stats = service.getStats();
      expect(stats.enqueued).toBe(3);
      expect(stats.inserted).toBe(1);
      expect(stats.duplicatesSkipped).toBe(1);
      expect(stats.flushes).toBe(1);
      expect(stats.buffered).toBe(0);
    });
  });

  it('falls back to defaults when configuration is absent', async () => {
    config.get.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkEventLoaderService,
        { provide: ConfigService, useValue: config },
        { provide: BULK_EVENT_WRITER, useValue: writer },
      ],
    }).compile();

    const fresh = module.get<BulkEventLoaderService>(BulkEventLoaderService);
    fresh.onModuleInit();

    // 5,000-event / 500ms defaults, per the issue's buffering contract.
    fresh.enqueueMany(
      Array.from({ length: 4_999 }, (_, i) => event({ eventSequence: i })),
    );
    jest.advanceTimersByTime(499);
    await Promise.resolve();
    expect(writer.bulkUpsertEvents).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(writer.bulkUpsertEvents).toHaveBeenCalledTimes(1);
  });

  it('wires BULK_EVENT_WRITER to the real CallEventStoreService in the module graph', async () => {
    // Guards the DI contract: the symbol the loader injects must resolve to
    // the service that actually implements bulkUpsertEvents.
    const repo = { query: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkEventLoaderService,
        { provide: ConfigService, useValue: config },
        {
          provide: BULK_EVENT_WRITER,
          useExisting: CallEventStoreService,
        },
        CallEventStoreService,
        { provide: getRepositoryToken(Call), useValue: repo },
        // CallEventStoreService reorg handling needs a DataSource; unused here.
        { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
      ],
    }).compile();

    const wired = module.get<BulkEventWriter>(BULK_EVENT_WRITER);
    expect(wired).toBeInstanceOf(CallEventStoreService);
    expect(typeof wired.bulkUpsertEvents).toBe('function');
  });
});
