/**
 * call-event-store.service.spec.ts  (BE-002 / BE-004)
 *
 * Unit tests for CallEventStoreService covering:
 *  - Idempotent upsert (no duplicate on re-delivery)
 *  - handleReorg: atomic QueryRunner orphan batch
 *  - rewindToLedger: SERIALIZABLE transaction, rollback on error
 *  - getActiveEvents: filters non-orphaned rows
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CallEventStoreService } from './call-event-store.service';
import type { UpsertCallEventInput } from './call-event-store.service';
import { Call, ChainType } from '../entities/call.entity';

// ─── QueryRunner factory ──────────────────────────────────────────────────────

function makeQueryRunner(executeResult = { affected: 2 }) {
  const execute = jest.fn().mockResolvedValue(executeResult);
  const andWhere = jest.fn().mockReturnThis();
  const where = jest.fn().mockReturnThis();
  const set = jest.fn().mockReturnThis();
  const update = jest.fn().mockReturnThis();
  const qb = { update, set, where, andWhere, execute };

  return {
    qb,
    runner: {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        save: jest.fn().mockResolvedValue(undefined),
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CallEventStoreService (BE-002 / BE-004)', () => {
  let service: CallEventStoreService;
  let repo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    query: jest.Mock;
  };
  let dataSource: { createQueryRunner: jest.Mock };
  let qrMock: ReturnType<typeof makeQueryRunner>;

  beforeEach(async () => {
    qrMock = makeQueryRunner();

    repo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((x: unknown) => x),
      save: jest.fn((x: unknown) => Promise.resolve(x)),
      query: jest.fn(),
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(qrMock.runner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallEventStoreService,
        { provide: getRepositoryToken(Call), useValue: repo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<CallEventStoreService>(CallEventStoreService);
  });

  // ── Idempotent upsert ───────────────────────────────────────────────────────

  describe('upsertEvent — idempotency', () => {
    it('creates a new row when no existing (chain, txHash, eventSequence) found', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.find.mockResolvedValue([]); // no conflicting rows for reorg check

      const result = await service.upsertEvent({
        chain: ChainType.STELLAR,
        txHash: 'tx-new',
        eventType: 'CallCreated',
        eventSequence: 0,
        ledgerHeight: 100,
        blockHash: 'hash-100',
      });

      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
      expect((result as { chain: ChainType }).chain).toBe(ChainType.STELLAR);
    });

    it('updates in place on re-delivery (same chain+txHash+sequence)', async () => {
      const existing = {
        id: 'abc',
        chain: ChainType.STELLAR,
        txHash: 'tx1',
        eventSequence: 0,
        eventData: { old: true },
        blockHash: 'h1',
        isOrphaned: false,
      };
      repo.findOne.mockResolvedValue(existing);
      repo.find.mockResolvedValue([]); // no reorg rows

      await service.upsertEvent({
        chain: ChainType.STELLAR,
        txHash: 'tx1',
        eventType: 'CallCreated',
        eventSequence: 0,
        eventData: { new: true },
      });

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'abc', eventData: { new: true } }),
      );
    });
  });

  // ── handleReorg — atomic QueryRunner ────────────────────────────────────────

  describe('handleReorg', () => {
    it('orphans conflicting rows in a QueryRunner transaction', async () => {
      const staleRow = {
        id: 'stale-1',
        chain: ChainType.STELLAR,
        ledgerHeight: 500,
        blockHash: 'old-hash',
        isOrphaned: false,
      };
      repo.find.mockResolvedValue([staleRow]);

      const count = await service.handleReorg(ChainType.STELLAR, 500, 'new-hash');

      expect(count).toBe(1);
      expect(qrMock.runner.startTransaction).toHaveBeenCalled();
      expect(qrMock.runner.manager.save).toHaveBeenCalledWith(
        Call,
        [expect.objectContaining({ id: 'stale-1', isOrphaned: true })],
      );
      expect(qrMock.runner.commitTransaction).toHaveBeenCalled();
      expect(qrMock.runner.release).toHaveBeenCalled();
    });

    it('returns 0 and skips transaction when no conflicting rows', async () => {
      repo.find.mockResolvedValue([
        { id: 'ok', chain: ChainType.STELLAR, ledgerHeight: 500, blockHash: 'same', isOrphaned: false },
      ]);

      const count = await service.handleReorg(ChainType.STELLAR, 500, 'same');
      expect(count).toBe(0);
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('does not re-orphan already-orphaned rows', async () => {
      repo.find.mockResolvedValue([
        { id: 'gone', blockHash: 'old', isOrphaned: true },
      ]);
      const count = await service.handleReorg(ChainType.STELLAR, 500, 'new');
      expect(count).toBe(0);
    });

    it('rolls back and rethrows when manager.save fails', async () => {
      const staleRow = { id: 's', blockHash: 'old', isOrphaned: false, ledgerHeight: 10 };
      repo.find.mockResolvedValue([staleRow]);
      qrMock.runner.manager.save = jest.fn().mockRejectedValue(new Error('write fail'));

      await expect(
        service.handleReorg(ChainType.STELLAR, 10, 'new'),
      ).rejects.toThrow('write fail');

      expect(qrMock.runner.rollbackTransaction).toHaveBeenCalled();
      expect(qrMock.runner.release).toHaveBeenCalled();
    });
  });

  // ── rewindToLedger ──────────────────────────────────────────────────────────

  describe('rewindToLedger', () => {
    it('executes a SERIALIZABLE UPDATE to orphan rows beyond the rewind point', async () => {
      const count = await service.rewindToLedger(ChainType.STELLAR, 99);
      expect(count).toBe(2); // from mock affected
      expect(qrMock.runner.startTransaction).toHaveBeenCalledWith('SERIALIZABLE');
      expect(qrMock.runner.commitTransaction).toHaveBeenCalled();
    });

    it('rolls back and rethrows on execute failure', async () => {
      qrMock.qb.execute.mockRejectedValueOnce(new Error('timeout'));
      await expect(service.rewindToLedger(ChainType.STELLAR, 99)).rejects.toThrow('timeout');
      expect(qrMock.runner.rollbackTransaction).toHaveBeenCalled();
      expect(qrMock.runner.release).toHaveBeenCalled();
    });

    it('always releases the QueryRunner even on error', async () => {
      qrMock.qb.execute.mockRejectedValueOnce(new Error('fail'));
      await expect(service.rewindToLedger(ChainType.STELLAR, 99)).rejects.toThrow();
      expect(qrMock.runner.release).toHaveBeenCalled();
    });
  });

  // ── getActiveEvents ──────────────────────────────────────────────────────────

  describe('getActiveEvents', () => {
    it('queries only non-orphaned rows for the given chain', async () => {
      repo.find.mockResolvedValue([]);
      await service.getActiveEvents(ChainType.BASE, 10);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chain: ChainType.BASE, isOrphaned: false },
          take: 10,
        }),
      );
    });
  });

  // ── upsertEvent reorg integration ────────────────────────────────────────────

  it('upsertEvent runs reorg check before writing when blockHash is provided', async () => {
    const staleRow = {
      id: 'stale-2',
      chain: ChainType.STELLAR,
      ledgerHeight: 42,
      blockHash: 'closed-at-old',
      isOrphaned: false,
    };
    repo.find.mockResolvedValue([staleRow]);
    repo.findOne.mockResolvedValue(null);

    await service.upsertEvent({
      chain: ChainType.STELLAR,
      txHash: 'tx-new',
      eventType: 'OutcomeSubmitted',
      eventSequence: 1,
      ledgerHeight: 42,
      blockHash: 'closed-at-new',
    });

    // handleReorg should have been triggered first (QueryRunner used)
    expect(qrMock.runner.startTransaction).toHaveBeenCalled();
    expect(qrMock.runner.manager.save).toHaveBeenCalledWith(
      Call,
      [expect.objectContaining({ id: 'stale-2', isOrphaned: true })],
    );
    // Then the new row was inserted
    expect(repo.create).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BE-008 — bulk write path
  // ─────────────────────────────────────────────────────────────────────────
  describe('bulkUpsertEvents', () => {
    let query: jest.Mock;

    const event = (
      over: Partial<UpsertCallEventInput> = {},
    ): UpsertCallEventInput => ({
      chain: ChainType.STELLAR,
      txHash: 'tx-1',
      eventType: 'CallCreated',
      eventSequence: 0,
      ledgerHeight: 100,
      ...over,
    });

    /** Bind-parameter arrays from the generated statements. */
    const params = (): unknown[][] =>
      query.mock.calls.map((call) => call[1] as unknown[]);

    beforeEach(() => {
      query = jest.fn().mockResolvedValue([{ id: 'row-1' }]);
      repo.query = query;
    });

    it('returns an empty result without touching the database', async () => {
      await expect(service.bulkUpsertEvents([])).resolves.toEqual({
        attempted: 0,
        deduplicated: 0,
        inserted: 0,
        duplicatesSkipped: 0,
        statements: 0,
        durationMs: 0,
        throughputPerSecond: 0,
      });
      expect(query).not.toHaveBeenCalled();
    });

    it('writes a whole batch in a single statement', async () => {
      query.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

      const result = await service.bulkUpsertEvents([
        event({ eventSequence: 1 }),
        event({ eventSequence: 2 }),
        event({ eventSequence: 3 }),
      ]);

      expect(query).toHaveBeenCalledTimes(1);
      expect(result.attempted).toBe(3);
      expect(result.inserted).toBe(3);
      expect(result.duplicatesSkipped).toBe(0);
      expect(result.statements).toBe(1);
    });

    it('generates an idempotent INSERT with a conflict target on the unique index', async () => {
      await service.bulkUpsertEvents([event()]);

      const sql = query.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO "calls"');
      expect(sql).toContain('ON CONFLICT ("chain", "txHash", "eventSequence")');
      expect(sql).toContain('DO NOTHING');
      // RETURNING makes the inserted count exact — skipped rows return nothing.
      expect(sql).toContain('RETURNING "id"');
    });

    it('emits sequential $n placeholders across all rows of a chunk', async () => {
      await service.bulkUpsertEvents([
        event({ eventSequence: 1 }),
        event({ eventSequence: 2 }),
      ]);

      const sql = query.mock.calls[0][0] as string;
      // 12 columns become parameters per row; createdAt/updatedAt are literal
      // DEFAULT, so they are not bound.
      expect(sql).toMatch(/\(\$1, \$2,[\s\S]*\$12, DEFAULT, DEFAULT\)/);
      // The second row continues the numbering from where the first left off.
      expect(sql).toMatch(/\(\$13, \$14,[\s\S]*\$24, DEFAULT, DEFAULT\)/);
      expect(params()[0]).toHaveLength(24);
    });

    it('binds event data as a serialised jsonb string, not as SQL text', async () => {
      await service.bulkUpsertEvents([
        event({ eventData: { amount: '100', note: "'; DROP TABLE calls; --" } }),
      ]);

      const bound = params()[0];
      expect(bound[10]).toBe(
        JSON.stringify({ amount: '100', note: "'; DROP TABLE calls; --" }),
      );
    });

    it('normalises absent optional fields to NULL', async () => {
      await service.bulkUpsertEvents([
        event({ eventSequence: undefined, ledgerHeight: undefined }),
      ]);

      const bound = params()[0];
      expect(bound[3]).toBeNull(); // contractId
      expect(bound[4]).toBeNull(); // stellarContractId
      expect(bound[5]).toBeNull(); // baseContractAddress
      expect(bound[7]).toBeNull(); // eventSequence
      expect(bound[8]).toBeNull(); // ledgerHeight
      expect(bound[9]).toBeNull(); // blockHash
      expect(bound[10]).toBeNull(); // eventData
    });

    it('lets the database stamp createdAt/updatedAt', async () => {
      await service.bulkUpsertEvents([event()]);

      const sql = query.mock.calls[0][0] as string;
      expect(sql).toContain('"createdAt", "updatedAt"');
      expect(sql).toContain('DEFAULT, DEFAULT');
    });

    it('generates a uuid primary key in the application', async () => {
      await service.bulkUpsertEvents([event()]);

      const id = params()[0][0] as string;
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('reports conflicts as duplicates rather than insertions', async () => {
      // Only one of the three made it past ON CONFLICT DO NOTHING.
      query.mockResolvedValue([{ id: 'a' }]);

      const result = await service.bulkUpsertEvents([
        event({ eventSequence: 1 }),
        event({ eventSequence: 2 }),
        event({ eventSequence: 3 }),
      ]);

      expect(result.inserted).toBe(1);
      expect(result.duplicatesSkipped).toBe(2);
    });

    it('collapses duplicates within a single batch before writing', async () => {
      const result = await service.bulkUpsertEvents([
        event({ eventSequence: 1 }),
        event({ eventSequence: 1 }),
        event({ eventSequence: 2 }),
      ]);

      expect(result.attempted).toBe(3);
      expect(result.deduplicated).toBe(1);
      // One statement, two rows — the repeat never reaches the database.
      expect(query).toHaveBeenCalledTimes(1);
      expect(params()[0]).toHaveLength(24);
    });

    it('treats a missing eventSequence as part of the idempotency key', async () => {
      // Mirrors the IsNull() lookup in upsertEvent: two chain-scoped events
      // with no sequence are the same event as far as dedupe is concerned.
      const result = await service.bulkUpsertEvents([
        event({ txHash: 'tx-a', eventSequence: undefined }),
        event({ txHash: 'tx-a', eventSequence: undefined }),
        event({ txHash: 'tx-b', eventSequence: undefined }),
      ]);

      expect(result.deduplicated).toBe(1);
    });

    it('does not collapse events that differ only by chain', async () => {
      const result = await service.bulkUpsertEvents([
        event({ chain: ChainType.BASE, eventSequence: 1 }),
        event({ chain: ChainType.STELLAR, eventSequence: 1 }),
      ]);

      expect(result.deduplicated).toBe(0);
      expect(params()[0]).toHaveLength(24);
    });

    it('splits a batch into multiple statements at the row limit', async () => {
      query.mockResolvedValue([{ id: 'x' }]);

      const result = await service.bulkUpsertEvents(
        Array.from({ length: 250 }, (_, i) => event({ eventSequence: i })),
        { maxRowsPerStatement: 100, maxConcurrency: 1 },
      );

      expect(query).toHaveBeenCalledTimes(3);
      expect(params().map((p) => p.length)).toEqual([1200, 1200, 600]);
      expect(result.inserted).toBe(3);
    });

    it('clamps the row limit so a statement can never exceed the bind-parameter limit', async () => {
      await service.bulkUpsertEvents([event()], {
        maxRowsPerStatement: 1_000_000,
      });

      // 65535 / 12 = 5461 rows max; the service must never ask for more.
      const rowsPerStatement = (query.mock.calls[0][1] as unknown[]).length / 12;
      expect(rowsPerStatement).toBeLessThanOrEqual(5461);
    });

    it('never issues more concurrent statements than maxConcurrency', async () => {
      let inFlight = 0;
      let peak = 0;
      query.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return [{ id: 'x' }];
      });

      await service.bulkUpsertEvents(
        Array.from({ length: 40 }, (_, i) => event({ eventSequence: i })),
        { maxRowsPerStatement: 1, maxConcurrency: 3 },
      );

      expect(peak).toBeLessThanOrEqual(3);
      expect(query).toHaveBeenCalledTimes(40);
    });

    it('retries a failed statement and succeeds on a later attempt', async () => {
      query
        .mockRejectedValueOnce(new Error('deadlock detected'))
        .mockResolvedValueOnce([{ id: 'a' }]);

      const result = await service.bulkUpsertEvents([event()], {
        maxRetries: 2,
        retryDelayMs: 1,
      });

      expect(query).toHaveBeenCalledTimes(2);
      expect(result.inserted).toBe(1);
    });

    it('gives up after exhausting retries but does not throw', async () => {
      query.mockRejectedValue(new Error('connection terminated'));

      const result = await service.bulkUpsertEvents(
        [event(), event({ eventSequence: 2 })],
        { maxRetries: 1, retryDelayMs: 1 },
      );

      expect(query).toHaveBeenCalledTimes(2); // initial + 1 retry
      expect(result.inserted).toBe(0);
      expect(result.duplicatesSkipped).toBe(2);
    });

    it('keeps writing later chunks after one chunk is abandoned', async () => {
      query
        .mockRejectedValueOnce(new Error('connection terminated'))
        .mockResolvedValue([{ id: 'a' }]);

      const result = await service.bulkUpsertEvents(
        Array.from({ length: 4 }, (_, i) => event({ eventSequence: i })),
        { maxRowsPerStatement: 1, maxConcurrency: 1, maxRetries: 0 },
      );

      expect(result.inserted).toBe(3);
    });

    it('reports a non-zero throughput for a completed write', async () => {
      query.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      const result = await service.bulkUpsertEvents([
        event({ eventSequence: 1 }),
        event({ eventSequence: 2 }),
      ]);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.throughputPerSecond).toBeGreaterThanOrEqual(0);
    });

    it('falls back to rowCount when the driver returns a raw result', async () => {
      // A driver that reports a count but no collected rows.
      query.mockResolvedValue({ rowCount: 2, command: 'INSERT' });

      const result = await service.bulkUpsertEvents([
        event({ eventSequence: 1 }),
        event({ eventSequence: 2 }),
      ]);

      expect(result.inserted).toBe(2);
    });

    it('prefers the returned rows over rowCount when a driver sends both', async () => {
      // RETURNING output is the authoritative count for DO NOTHING; a
      // rowCount that disagreed with it would misreport what was written.
      query.mockResolvedValue({ rows: [{ id: 'a' }], rowCount: 99 });

      const result = await service.bulkUpsertEvents([
        event({ eventSequence: 1 }),
        event({ eventSequence: 2 }),
      ]);

      expect(result.inserted).toBe(1);
    });

    it('reads a wrapped row array from drivers that return a result object', async () => {
      // Reporting zero for a write that actually happened would show up as a
      // permanently "duplicate" batch, so the wrapped shape is handled too.
      query.mockResolvedValue({ rows: [{ id: 'a' }, { id: 'b' }] });

      const result = await service.bulkUpsertEvents([
        event({ eventSequence: 1 }),
        event({ eventSequence: 2 }),
      ]);

      expect(result.inserted).toBe(2);
    });

    it('reads affectedRows when that is the only count available', async () => {
      query.mockResolvedValue({ affectedRows: 1 });

      const result = await service.bulkUpsertEvents([event()]);

      expect(result.inserted).toBe(1);
    });

    it('never reports more rows than were attempted', async () => {
      // An unrecognised driver shape must under-report (safe to retry), never
      // invent an insertion count.
      query.mockResolvedValue(undefined);

      const result = await service.bulkUpsertEvents([event()]);

      expect(result.inserted).toBe(0);
      expect(result.duplicatesSkipped).toBe(1);
    });
  });
});
