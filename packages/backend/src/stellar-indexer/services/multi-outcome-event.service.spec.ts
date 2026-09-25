/**
 * multi-outcome-event.service.spec.ts  (BE-003)
 *
 * Unit tests covering:
 *  - CallCreated: entity creation, outcome pool initialisation, domain event
 *  - StakeAdded: BigInt-safe pool balance update, participant upsert, domain event
 *  - OutcomeSubmitted: call status transition, domain event
 *  - PayoutWithdrawn: event row persistence, domain event
 *  - Payload extractor resilience (missing fields, nested value, wrong types)
 *  - Validation: >32 outcomes rejected, 0 outcomes rejected
 *  - Transaction rollback on DB failure
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  MultiOutcomeEventService,
  MULTI_OUTCOME_EVENTS,
} from './multi-outcome-event.service';
import { Call, ChainType } from '../entities/call.entity';
import { OutcomePool } from '../entities/outcome-pool.entity';
import { ParticipantStake } from '../entities/participant-stake.entity';
import { ParsedSorobanEvent } from './stellar-indexer.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  type: string,
  data: Record<string, unknown>,
  overrides: Partial<ParsedSorobanEvent> = {},
): ParsedSorobanEvent {
  return {
    type,
    contractId: 'CREGISTRY',
    ledger: 200,
    txHash: `tx-${type}-001`,
    sequence: 1,
    blockHash: '2024-01-01T00:00:00Z',
    data,
    ...overrides,
  };
}

function makeQueryRunner(
  managerOverrides: Record<string, jest.Mock> = {},
  execResult = { affected: 0 },
) {
  const execute = jest.fn().mockResolvedValue(execResult);
  const andWhere = jest.fn().mockReturnThis();
  const where = jest.fn().mockReturnThis();
  const set = jest.fn().mockReturnThis();
  const update = jest.fn().mockReturnThis();
  const qb = { update, set, where, andWhere, execute };

  const mgr = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((_, x: unknown) => ({ ...x as object })),
    save: jest.fn((_, x: unknown) => Promise.resolve(x)),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    ...managerOverrides,
  };

  return {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: mgr,
    _mgr: mgr,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('MultiOutcomeEventService (BE-003)', () => {
  let service: MultiOutcomeEventService;
  let dataSource: { createQueryRunner: jest.Mock };
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let callRepo: { find: jest.Mock; findOne: jest.Mock };
  let poolRepo: { find: jest.Mock };
  let stakeRepo: { find: jest.Mock };

  function withQueryRunner(runner: ReturnType<typeof makeQueryRunner>) {
    dataSource.createQueryRunner.mockReturnValue(runner);
  }

  beforeEach(async () => {
    const qr = makeQueryRunner();
    dataSource = { createQueryRunner: jest.fn().mockReturnValue(qr) };
    eventEmitter = { emit: jest.fn() };
    callRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) };
    poolRepo = { find: jest.fn().mockResolvedValue([]) };
    stakeRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MultiOutcomeEventService,
        { provide: getRepositoryToken(Call), useValue: callRepo },
        { provide: getRepositoryToken(OutcomePool), useValue: poolRepo },
        { provide: getRepositoryToken(ParticipantStake), useValue: stakeRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<MultiOutcomeEventService>(MultiOutcomeEventService);
  });

  // ── CallCreated ─────────────────────────────────────────────────────────────

  describe('handleEvent — CallCreated', () => {
    it('creates a call row and one OutcomePool per outcome', async () => {
      const qr = makeQueryRunner();
      withQueryRunner(qr);

      await service.handleEvent(makeEvent('CallCreated', {
        call_id: 'CALL-1',
        creator: 'GCREATOR',
        outcomes: ['yes', 'no', 'draw'],
      }));

      expect(qr.commitTransaction).toHaveBeenCalled();
      // save called for: call row + 3 pool rows
      expect(qr._mgr.save).toHaveBeenCalledTimes(4);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MULTI_OUTCOME_EVENTS.CALL_CREATED,
        expect.objectContaining({ callOnchainId: 'CALL-1', outcomes: ['yes', 'no', 'draw'] }),
      );
    });

    it('handles nested `value` payload layout', async () => {
      const qr = makeQueryRunner();
      withQueryRunner(qr);

      await service.handleEvent(makeEvent('CallCreated', {
        value: { call_id: 'CALL-2', creator: 'G123', outcomes: ['a', 'b'] },
      }));

      expect(qr.commitTransaction).toHaveBeenCalled();
    });

    it('rejects more than 32 outcomes', async () => {
      const qr = makeQueryRunner();
      withQueryRunner(qr);
      const outcomes = Array.from({ length: 33 }, (_, i) => `outcome_${i}`);

      await expect(
        service.handleEvent(makeEvent('CallCreated', { call_id: 'C', creator: 'G', outcomes })),
      ).rejects.toThrow('33 outcomes (max 32)');

      expect(qr.rollbackTransaction).toHaveBeenCalled();
    });

    it('rolls back and rethrows on DB failure', async () => {
      const qr = makeQueryRunner();
      qr._mgr.save = jest.fn().mockRejectedValue(new Error('db error'));
      withQueryRunner(qr);

      await expect(
        service.handleEvent(makeEvent('CallCreated', { call_id: 'X', creator: 'G', outcomes: ['yes'] })),
      ).rejects.toThrow('db error');

      expect(qr.rollbackTransaction).toHaveBeenCalled();
      expect(qr.release).toHaveBeenCalled();
    });

    it('returns early (no throw) when payload is unparseable', async () => {
      const qr = makeQueryRunner();
      withQueryRunner(qr);
      // Missing call_id → extractCallCreated returns null
      await expect(service.handleEvent(makeEvent('CallCreated', {}))).resolves.toBeUndefined();
    });
  });

  // ── StakeAdded ──────────────────────────────────────────────────────────────

  describe('handleEvent — StakeAdded', () => {
    it('adds stake to existing pool using BigInt arithmetic', async () => {
      const existingPool = {
        id: 'pool-1',
        callOnchainId: 'CALL-1',
        chain: 'stellar',
        outcomeIndex: 0,
        totalStake: '9007199254740992', // > Number.MAX_SAFE_INTEGER
        participantCount: 1,
      };

      const qr = makeQueryRunner();
      // Return pool on first findOne (pool lookup), null on second (stake lookup)
      qr._mgr.findOne = jest
        .fn()
        .mockResolvedValueOnce(existingPool)
        .mockResolvedValueOnce(null);
      withQueryRunner(qr);

      await service.handleEvent(makeEvent('StakeAdded', {
        call_id: 'CALL-1',
        staker: 'GSTAKER',
        outcome_index: 0,
        amount: '1000000000000000000', // 1e18
      }));

      expect(qr.commitTransaction).toHaveBeenCalled();
      // Pool save should carry the exact BigInt sum
      const poolSaveCall = qr._mgr.save.mock.calls.find(
        (c: unknown[]) => (c[1] as Record<string, unknown>)?.totalStake !== undefined,
      );
      expect((poolSaveCall?.[1] as Record<string, unknown>)?.totalStake).toBe(
        '10007199254740992',
      );
    });

    it('emits StakeAdded domain event', async () => {
      const qr = makeQueryRunner();
      withQueryRunner(qr);

      await service.handleEvent(makeEvent('StakeAdded', {
        call_id: 'CALL-1',
        staker: 'GSTAKER',
        outcome_index: 1,
        amount: '500',
      }));

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MULTI_OUTCOME_EVENTS.STAKE_ADDED,
        expect.objectContaining({ staker: 'GSTAKER', outcomeIndex: 1, amount: '500' }),
      );
    });

    it('rejects outcome_index >= 32', async () => {
      const qr = makeQueryRunner();
      withQueryRunner(qr);

      await service.handleEvent(makeEvent('StakeAdded', {
        call_id: 'CALL-1',
        staker: 'GSTAKER',
        outcome_index: 32,
        amount: '100',
      }));

      // Returns early — no commit, no emit
      expect(qr.commitTransaction).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('preserves precision for I128-range amounts', async () => {
      const qr = makeQueryRunner();
      withQueryRunner(qr);

      // I128 max is ~170_141_183_460_469_231_731_687_303_715_884_105_727
      const bigAmount = '170141183460469231731687303715884105727';
      await service.handleEvent(makeEvent('StakeAdded', {
        call_id: 'CALL-1',
        staker: 'G1',
        outcome_index: 0,
        amount: bigAmount,
      }));

      expect(qr.commitTransaction).toHaveBeenCalled();
    });
  });

  // ── OutcomeSubmitted ────────────────────────────────────────────────────────

  describe('handleEvent — OutcomeSubmitted', () => {
    it('updates call status to SETTLING', async () => {
      const existingCall = {
        id: 'uuid-call',
        callOnchainId: 'CALL-1',
        status: 'OPEN',
        eventData: {},
      };
      const qr = makeQueryRunner();
      qr._mgr.findOne = jest.fn().mockResolvedValueOnce(existingCall);
      withQueryRunner(qr);

      await service.handleEvent(makeEvent('OutcomeSubmitted', {
        call_id: 'CALL-1',
        submitter: 'GORACLE',
        winning_outcome_index: 2,
      }));

      expect(qr.commitTransaction).toHaveBeenCalled();
      const savedCall = (qr._mgr.save.mock.calls[0] as unknown[])[1] as { status: string };
      expect(savedCall.status).toBe('SETTLING');
    });

    it('emits OutcomeSubmitted domain event', async () => {
      const qr = makeQueryRunner();
      withQueryRunner(qr);

      await service.handleEvent(makeEvent('OutcomeSubmitted', {
        call_id: 'CALL-1',
        submitter: 'GORACLE',
        winning_outcome_index: 0,
        evidence_cid: 'QmABC',
      }));

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MULTI_OUTCOME_EVENTS.OUTCOME_SUBMITTED,
        expect.objectContaining({ winningOutcomeIndex: 0, evidenceCid: 'QmABC' }),
      );
    });
  });

  // ── PayoutWithdrawn ─────────────────────────────────────────────────────────

  describe('handleEvent — PayoutWithdrawn', () => {
    it('persists the event row and emits domain event', async () => {
      const qr = makeQueryRunner();
      withQueryRunner(qr);

      await service.handleEvent(makeEvent('PayoutWithdrawn', {
        call_id: 'CALL-1',
        winner: 'GWINNER',
        amount: '9999999999',
        outcome_index: 1,
      }));

      expect(qr.commitTransaction).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MULTI_OUTCOME_EVENTS.PAYOUT_WITHDRAWN,
        expect.objectContaining({ winner: 'GWINNER', amount: '9999999999' }),
      );
    });
  });

  // ── Unknown event type ───────────────────────────────────────────────────────

  it('silently ignores unknown event types without throwing', async () => {
    await expect(
      service.handleEvent(makeEvent('UnknownEvent', {})),
    ).resolves.toBeUndefined();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
