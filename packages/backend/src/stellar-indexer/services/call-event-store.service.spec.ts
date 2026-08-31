import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CallEventStoreService } from './call-event-store.service';
import { Call, ChainType } from '../entities/call.entity';

describe('CallEventStoreService (BE-04)', () => {
  let service: CallEventStoreService;
  let repo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((x: unknown) => x),
      save: jest.fn((x: unknown) => Promise.resolve(x)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallEventStoreService,
        { provide: getRepositoryToken(Call), useValue: repo },
      ],
    }).compile();

    service = module.get<CallEventStoreService>(CallEventStoreService);
  });

  describe('upsertEvent — idempotency', () => {
    it('creates a new row when no matching (chain, txHash, eventSequence) exists', async () => {
      repo.findOne.mockResolvedValue(null);

      const call = await service.upsertEvent({
        chain: ChainType.STELLAR,
        txHash: 'tx1',
        eventType: 'CallCreated',
        eventSequence: 0,
        ledgerHeight: 100,
      });

      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
      expect((call as { chain: ChainType }).chain).toBe(ChainType.STELLAR);
    });

    it('updates the existing row in place instead of creating a duplicate on re-delivery', async () => {
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

      await service.upsertEvent({
        chain: ChainType.STELLAR,
        txHash: 'tx1',
        eventType: 'CallCreated',
        eventSequence: 0,
        eventData: { old: false },
      });

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'abc', eventData: { old: false } }),
      );
    });
  });

  describe('handleReorg', () => {
    it('orphans rows at the same height whose blockHash no longer matches', async () => {
      const staleRow = {
        id: 'stale-1',
        chain: ChainType.BASE,
        ledgerHeight: 500,
        blockHash: '0xOLD',
        isOrphaned: false,
      };
      repo.find.mockResolvedValue([staleRow]);

      const orphanedCount = await service.handleReorg(
        ChainType.BASE,
        500,
        '0xNEW',
      );

      expect(orphanedCount).toBe(1);
      expect(repo.save).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'stale-1', isOrphaned: true }),
      ]);
    });

    it('does nothing when the blockHash matches (no reorg)', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'ok-1',
          chain: ChainType.BASE,
          ledgerHeight: 500,
          blockHash: '0xSAME',
          isOrphaned: false,
        },
      ]);

      const orphanedCount = await service.handleReorg(
        ChainType.BASE,
        500,
        '0xSAME',
      );

      expect(orphanedCount).toBe(0);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('does not re-orphan rows that are already orphaned', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'gone',
          chain: ChainType.BASE,
          ledgerHeight: 500,
          blockHash: '0xOLD',
          isOrphaned: true,
        },
      ]);

      const orphanedCount = await service.handleReorg(
        ChainType.BASE,
        500,
        '0xNEW',
      );
      expect(orphanedCount).toBe(0);
    });

    it('upsertEvent runs reorg detection before writing when blockHash + ledgerHeight are given', async () => {
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

      // handleReorg's save (array arg) should have run before the new row's save (object arg)
      expect((repo.save.mock.calls[0] as unknown[])[0]).toEqual([
        expect.objectContaining({ id: 'stale-2', isOrphaned: true }),
      ]);
    });
  });

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
});
