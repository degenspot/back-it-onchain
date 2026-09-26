/**
 * ledger-checkpoint.service.spec.ts  (BE-002)
 *
 * Unit tests for:
 *  - InMemoryLedgerCheckpointStore (basic cursor semantics)
 *  - LedgerCheckpointService (durable + reorg detection)
 *    - detectAndRewind: triggers only on hash mismatch at same sequence
 *    - atomicRewind: calls QueryRunner in a SERIALIZABLE transaction
 *    - validateAndSave: end-to-end save with/without reorg
 */

import {
  InMemoryLedgerCheckpointStore,
  LedgerCheckpointService,
} from './ledger-checkpoint.service';
import { LedgerCheckpointEntity } from '../entities/ledger-checkpoint.entity';

// ─── InMemoryLedgerCheckpointStore ────────────────────────────────────────────

describe('InMemoryLedgerCheckpointStore', () => {
  let store: InMemoryLedgerCheckpointStore;

  beforeEach(() => {
    store = new InMemoryLedgerCheckpointStore();
  });

  it('returns null when no checkpoint exists', async () => {
    await expect(store.load('missing')).resolves.toBeNull();
  });

  it('persists and reloads a checkpoint', async () => {
    await store.save('stream', 1000);
    await expect(store.load('stream')).resolves.toBe(1000);
  });

  it('advances the cursor forward', async () => {
    await store.save('stream', 1000);
    await store.save('stream', 1500);
    await expect(store.load('stream')).resolves.toBe(1500);
  });

  it('never rewinds the cursor to an earlier ledger', async () => {
    await store.save('stream', 1500);
    await store.save('stream', 900);
    await expect(store.load('stream')).resolves.toBe(1500);
  });

  it('rejects invalid ledger values', async () => {
    await expect(store.save('stream', -1)).rejects.toThrow();
    await expect(store.save('stream', Number.NaN)).rejects.toThrow();
  });

  it('keeps separate cursors per key', async () => {
    await store.save('a', 10);
    await store.save('b', 20);
    await expect(store.load('a')).resolves.toBe(10);
    await expect(store.load('b')).resolves.toBe(20);
  });
});

// ─── LedgerCheckpointService ──────────────────────────────────────────────────

describe('LedgerCheckpointService (BE-002)', () => {
  let service: LedgerCheckpointService;
  let checkpointRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let callRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  // QueryRunner mock
  let qrUpdate: jest.Mock;
  let qrSet: jest.Mock;
  let qrWhere: jest.Mock;
  let qrAndWhere: jest.Mock;
  let qrExecute: jest.Mock;
  let mockQueryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: {
      createQueryBuilder: () => {
        update: jest.Mock;
        set: jest.Mock;
        where: jest.Mock;
        andWhere: jest.Mock;
        execute: jest.Mock;
      };
      save: jest.Mock;
    };
  };
  let dataSource: { createQueryRunner: jest.Mock };

  beforeEach(() => {
    checkpointRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((x: unknown) => x),
      save: jest.fn((x: unknown) => Promise.resolve(x)),
    };

    callRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((x: unknown) => Promise.resolve(x)),
      createQueryBuilder: jest.fn(),
    };

    qrExecute = jest.fn().mockResolvedValue({ affected: 3 });
    qrAndWhere = jest.fn().mockReturnThis();
    qrWhere = jest.fn().mockReturnThis();
    qrSet = jest.fn().mockReturnThis();
    qrUpdate = jest.fn().mockReturnThis();

    mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        createQueryBuilder: () => ({
          update: qrUpdate,
          set: qrSet,
          where: qrWhere,
          andWhere: qrAndWhere,
          execute: qrExecute,
        }),
        save: jest.fn().mockResolvedValue(undefined),
      },
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    service = new LedgerCheckpointService(
      checkpointRepo as any,
      callRepo as any,
      dataSource as any,
    );
  });

  // ── load() ─────────────────────────────────────────────────────────────────

  it('load() returns null when no DB row exists', async () => {
    checkpointRepo.findOne.mockResolvedValue(null);
    await expect(service.load('stream-a')).resolves.toBeNull();
  });

  it('load() returns the stored ledger sequence', async () => {
    checkpointRepo.findOne.mockResolvedValue({
      ledgerSequence: '1234',
      isCanonical: true,
    });
    await expect(service.load('stream-a')).resolves.toBe(1234);
  });

  // ── validateAndSave() without reorg ────────────────────────────────────────

  it('validateAndSave() with matching hash does not trigger reorg', async () => {
    checkpointRepo.findOne.mockResolvedValue({
      streamKey: 'k',
      ledgerSequence: '100',
      ledgerHash: 'same-hash',
      isCanonical: true,
    });

    const result = await service.validateAndSave('k', 100, 'same-hash', 'stellar');
    expect(result.reorgDetected).toBe(false);
    // No QueryRunner should be created
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('validateAndSave() without hash saves without reorg check', async () => {
    checkpointRepo.findOne.mockResolvedValue(null);
    const result = await service.validateAndSave('k', 200, undefined, 'stellar');
    expect(result.reorgDetected).toBe(false);
    expect(checkpointRepo.save).toHaveBeenCalled();
  });

  // ── detectAndRewind() ──────────────────────────────────────────────────────

  it('detectAndRewind() returns reorgDetected=false when no prior checkpoint', async () => {
    checkpointRepo.findOne.mockResolvedValue(null);
    const result = await service.detectAndRewind('k', 100, 'new-hash', 'stellar');
    expect(result.reorgDetected).toBe(false);
  });

  it('detectAndRewind() returns reorgDetected=false when sequences differ', async () => {
    checkpointRepo.findOne.mockResolvedValue({
      ledgerSequence: '99',
      ledgerHash: 'old-hash',
      isCanonical: true,
    });
    const result = await service.detectAndRewind('k', 100, 'new-hash', 'stellar');
    expect(result.reorgDetected).toBe(false);
  });

  it('detectAndRewind() triggers reorg and runs atomicRewind on hash mismatch', async () => {
    const existingRow = {
      streamKey: 'k',
      ledgerSequence: '100',
      ledgerHash: 'old-hash',
      isCanonical: true,
    };
    checkpointRepo.findOne.mockResolvedValue(existingRow);

    const result = await service.detectAndRewind('k', 100, 'new-hash', 'stellar');

    expect(result.reorgDetected).toBe(true);
    expect(result.forkAtSequence).toBe(100);
    expect(result.rowsRewound).toBe(3); // from qrExecute mock
    // QueryRunner lifecycle
    expect(mockQueryRunner.startTransaction).toHaveBeenCalledWith('SERIALIZABLE');
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    expect(mockQueryRunner.release).toHaveBeenCalled();
    // Existing checkpoint should be marked non-canonical
    expect(checkpointRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isCanonical: false }),
    );
  });

  // ── atomicRewind() transaction safety ────────────────────────────────────

  it('atomicRewind() rolls back and rethrows on query failure', async () => {
    qrExecute.mockRejectedValueOnce(new Error('DB error'));

    await expect(service.atomicRewind('stellar', 100, 99)).rejects.toThrow('DB error');

    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(mockQueryRunner.release).toHaveBeenCalled();
  });

  it('atomicRewind() always releases the QueryRunner even on success', async () => {
    await service.atomicRewind('stellar', 100, 99);
    expect(mockQueryRunner.release).toHaveBeenCalled();
  });

  // ── Checkpoint cursor monotonicity ────────────────────────────────────────

  it('upsertCheckpoint (via save) does not rewind an existing checkpoint', async () => {
    checkpointRepo.findOne.mockResolvedValue({
      ledgerSequence: '500',
      ledgerHash: 'h1',
      isCanonical: true,
    });

    // Try to save an earlier ledger
    await service.save('k', 400);

    // checkpointRepo.save should NOT have been called (ledger < stored)
    expect(checkpointRepo.save).not.toHaveBeenCalled();
  });
});
