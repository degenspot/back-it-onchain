/**
 * calls.unfreeze.spec.ts  (BE-018)
 *
 * Covers the operator-facing half of the freeze: seeing what is frozen, and
 * lifting a freeze.
 *
 * The design decision worth stating, because the tests below enforce it: an
 * unfreeze returns the call to OPEN rather than settling it. The operator's job
 * is to decide the *cause* is fixed; the oracle's job is to fetch a price and
 * judge it again. So an unfreeze re-enters the normal path, staleness check
 * included, and a call whose feed is still bad simply re-freezes. That makes
 * the endpoint incapable of forcing a settlement, which is what stops it from
 * becoming the way around the guard.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { CallsService } from './calls.service';
import { Call } from './call.entity';
import { Participant } from './participant.entity';
import { Dispute } from './dispute.entity';
import { AuditLogService } from '../oracle/audit-log.service';
import { AuditLogAction } from '../oracle/audit-log.entity';

function makeCall(overrides: Partial<Call> = {}): Call {
  return {
    id: 7,
    callOnchainId: 700,
    tokenAddress: '0xtoken',
    chain: 'base',
    status: 'RESOLUTION_HALTED',
    resolutionHaltedReason: 'price feed is 660s old, over the 600s limit',
    ...overrides,
  } as Call;
}

describe('CallsService frozen-call recovery (BE-018)', () => {
  let service: CallsService;
  let callsRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let auditLogService: { append: jest.Mock };
  let eventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    callsRepository = {
      findOne: jest.fn().mockResolvedValue(makeCall()),
      save: jest.fn(async (call: Call) => call),
      find: jest.fn().mockResolvedValue([]),
    };
    auditLogService = { append: jest.fn().mockResolvedValue({ id: 1 }) };
    eventEmitter = { emit: jest.fn() };

    service = new CallsService(
      callsRepository as unknown as Repository<Call>,
      { find: jest.fn() } as unknown as Repository<Participant>,
      { find: jest.fn() } as unknown as Repository<Dispute>,
      { pin: jest.fn() } as never,
      eventEmitter as unknown as EventEmitter2,
      auditLogService as unknown as AuditLogService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('unfreezeResolution', () => {
    it('returns the call to OPEN so the next sweep re-resolves it', async () => {
      const saved = await service.unfreezeResolution(7, '0xadmin');
      expect(saved.status).toBe('OPEN');
    });

    it('clears the halt reason, so the reason is not left to mislead', async () => {
      const saved = await service.unfreezeResolution(7, '0xadmin');
      expect(saved.resolutionHaltedReason).toBeNull();
    });

    it('stamps a new status time', async () => {
      const saved = await service.unfreezeResolution(7, '0xadmin');
      expect(saved.statusUpdatedAt).toBeInstanceOf(Date);
    });

    it('never settles the call itself', async () => {
      // The guard is re-run on the next sweep. Settling here would let the
      // endpoint bypass the very check it exists to recover from.
      const saved = await service.unfreezeResolution(7, '0xadmin');
      expect(saved.status).not.toBe('SETTLED');
      expect(saved.outcome).toBeUndefined();
      expect(saved.oracleSignature).toBeUndefined();
    });

    it('records who lifted the freeze and why', async () => {
      await service.unfreezeResolution(7, '0xadmin', 'feed restored');
      expect(auditLogService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          callId: '7',
          action: AuditLogAction.ORACLE_RESOLUTION_UNFROZEN,
          actor: '0xadmin',
          payloadHash: expect.stringContaining('feed restored'),
        }),
      );
    });

    it('carries the previous reason into the audit entry', async () => {
      await service.unfreezeResolution(7, '0xadmin');
      const [entry] = auditLogService.append.mock.calls[0];
      expect(entry.payloadHash).toContain('660s old');
    });

    it('emits an event for other listeners', async () => {
      await service.unfreezeResolution(7, '0xadmin');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'oracle.resolution_unfrozen',
        expect.objectContaining({ callId: '7', adminWallet: '0xadmin' }),
      );
    });

    it('works with no note supplied', async () => {
      await expect(service.unfreezeResolution(7, '0xadmin')).resolves.toBeDefined();
    });

    it('404s on an unknown call', async () => {
      callsRepository.findOne.mockResolvedValue(null);
      await expect(service.unfreezeResolution(999, '0xadmin')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a call that is not frozen', async () => {
      // Guards against unfreezing an already-settled call, which would be a
      // way to re-open a finished market.
      callsRepository.findOne.mockResolvedValue(makeCall({ status: 'SETTLED' }));
      await expect(service.unfreezeResolution(7, '0xadmin')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses an UNRESOLVED call', async () => {
      callsRepository.findOne.mockResolvedValue(makeCall({ status: 'UNRESOLVED' }));
      await expect(service.unfreezeResolution(7, '0xadmin')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('names the current status in the refusal, so the caller can see why', async () => {
      callsRepository.findOne.mockResolvedValue(makeCall({ status: 'SETTLED' }));
      await expect(service.unfreezeResolution(7, '0xadmin')).rejects.toThrow(
        /SETTLED/,
      );
    });

    it('does not save or audit when it refuses', async () => {
      callsRepository.findOne.mockResolvedValue(makeCall({ status: 'SETTLED' }));
      await expect(service.unfreezeResolution(7, '0xadmin')).rejects.toThrow();
      expect(callsRepository.save).not.toHaveBeenCalled();
      expect(auditLogService.append).not.toHaveBeenCalled();
    });

    it('is idempotent in the sense that a second attempt is refused', async () => {
      await service.unfreezeResolution(7, '0xadmin');
      // The saved call is now OPEN, and the repository returns it.
      await expect(service.unfreezeResolution(7, '0xadmin')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findHaltedCalls', () => {
    it('filters on the frozen status', async () => {
      await service.findHaltedCalls();
      expect(callsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'RESOLUTION_HALTED' } }),
      );
    });

    it('orders most-recently-frozen first', async () => {
      await service.findHaltedCalls();
      expect(callsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { statusUpdatedAt: 'DESC' } }),
      );
    });

    it('defaults to 50', async () => {
      await service.findHaltedCalls();
      expect(callsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('caps the page size', async () => {
      await service.findHaltedCalls(10_000);
      expect(callsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('ignores a nonsense limit', async () => {
      await service.findHaltedCalls(0);
      expect(callsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });
  });
});
