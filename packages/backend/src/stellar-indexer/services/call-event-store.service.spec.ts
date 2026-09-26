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
});
