/**
 * resolution-halt.spec.ts  (BE-018)
 *
 * Where price-staleness.service.spec.ts tests the *rules*, this tests what
 * happens to a real call when a rule fires: that the freeze is durable, that it
 * is visible to an operator, and — most importantly — that it leaves behind
 * nothing that could be mistaken for a settlement.
 *
 * A signature is the dangerous artefact here. Once one exists, something
 * downstream may act on it, and "the call was frozen" becomes a footnote
 * rather than a stop. So the central assertion in the freeze tests is that no
 * signature and no evidence pin were produced.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { OracleService } from './oracle.service';
import { PriceStalenessService } from './price-staleness.service';
import { AdminService } from '../admin/admin.service';
import { Call } from '../calls/call.entity';
import { AuditLog, AuditLogAction } from './audit-log.entity';

const MAX_AGE = 600;
const MIN_VOLUME = 1_000;
const RESOLVED_AT_MS = 1_700_000_000_000;

const WEBHOOK = 'https://discord.test/webhook/be018';

function makeCall(overrides: Partial<Call> = {}): Call {
  return {
    id: 7,
    callOnchainId: 700,
    tokenAddress: '0xtoken',
    chain: 'base',
    status: 'SETTLING',
    endTs: new Date(RESOLVED_AT_MS),
    startPrice: 100,
    conditionJson: { type: 'PERCENT_GAIN', params: { pct: 5 } },
    ...overrides,
  } as Call;
}

describe('OracleService resolution freeze (BE-018)', () => {
  let service: OracleService;
  let staleness: PriceStalenessService;
  let manager: {
    query: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let callRepository: { find: jest.Mock };
  let auditRepository: Repository<AuditLog>;
  let eventEmitter: EventEmitter2;
  let ipfsPin: jest.Mock;
  let globalFetch: jest.Mock;

  const originalFetch = global.fetch;

  beforeEach(async () => {
    callRepository = { find: jest.fn().mockResolvedValue([]) };
    auditRepository = { save: jest.fn() } as unknown as Repository<AuditLog>;
    eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    ipfsPin = jest.fn().mockResolvedValue('Qm-evidence');

    manager = {
      query: jest.fn().mockResolvedValue([]),
      create: jest.fn((_entity: unknown, row: Call) => ({ ...row })),
      save: jest.fn(async (_entity: unknown, obj: unknown) => obj),
    };

    const config: Record<string, unknown> = {
      ORACLE_MAX_PRICE_AGE_SECONDS: MAX_AGE,
      ORACLE_MIN_24H_VOLUME_USD: MIN_VOLUME,
      ORACLE_RESOLUTION_BATCH_SIZE: 20,
      ORACLE_PRIVATE_KEY:
        '0x1234567890123456789012345678901234567890123456789012345678901234',
      DISCORD_ADMIN_WEBHOOK_URL: WEBHOOK,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleService,
        PriceStalenessService,
        {
          provide: ConfigService,
          useValue: { get: (key: string, def?: unknown) => config[key] ?? def ?? null },
        },
        {
          provide: AdminService,
          useValue: { isPaused: jest.fn(() => false) },
        },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: 'IPFS_SERVICE', useValue: { pin: ipfsPin } },
      ],
    }).compile();

    // Wire the optional dependencies the freeze path needs directly, so the
    // test exercises the real code rather than a null-guarded no-op.
    service = module.get(OracleService);
    staleness = module.get(PriceStalenessService);
    Reflect.set(service, 'dataSource', {
      transaction: (cb: (m: unknown) => unknown) => cb(manager),
    });
    Reflect.set(service, 'callRepository', callRepository);
    Reflect.set(service, 'auditLogRepository', auditRepository);
    Reflect.set(service, 'eventEmitter', eventEmitter);
    Reflect.set(service, 'ipfsService', { pin: ipfsPin });

    globalFetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = globalFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  /** Drive one call through the sweep with a specific quote. */
  async function resolveWith(quote: unknown, call = makeCall()) {
    manager.query.mockResolvedValue([call]);
    jest
      .spyOn(service, 'fetchPriceWithFallback')
      .mockResolvedValue(quote as never);

    const results = await service.resolveDueCalls();
    const saved = manager.save.mock.calls
      .filter(([entity]) => entity === Call)
      .map(([, obj]) => obj as Call);
    return { results, saved, final: saved[saved.length - 1] };
  }

  describe('a fresh, liquid price', () => {
    it('settles normally and never freezes', async () => {
      const { results, final } = await resolveWith({
        price: 110,
        source: 'dexscreener',
        timestamp: RESOLVED_AT_MS - 1_000,
        volume24h: 5_000_000,
      });

      expect(results).toEqual([
        expect.objectContaining({ callId: 7, status: 'SETTLED' }),
      ]);
      expect(final.status).toBe('SETTLED');
      expect(final.resolutionHaltedReason).toBeUndefined();
    });
  });

  describe('a stale price', () => {
    const staleQuote = {
      price: 110,
      source: 'dexscreener',
      timestamp: RESOLVED_AT_MS - (MAX_AGE + 60) * 1_000,
      volume24h: 5_000_000,
    };

    it('freezes the call as RESOLUTION_HALTED', async () => {
      const { results, final } = await resolveWith(staleQuote);

      expect(results).toEqual([
        expect.objectContaining({
          callId: 7,
          status: 'RESOLUTION_HALTED',
        }),
      ]);
      expect(final.status).toBe('RESOLUTION_HALTED');
    });

    it('records why it froze, for the operator to act on', async () => {
      const { final } = await resolveWith(staleQuote);
      expect(final.resolutionHaltedReason).toContain('s old, over the');
      expect(final.statusUpdatedAt).toBeInstanceOf(Date);
    });

    it('leaves no signature, so nothing downstream can act on it', async () => {
      const { final } = await resolveWith(staleQuote);
      expect(final.oracleSignature).toBeUndefined();
      expect(final.evidenceCid).toBeUndefined();
      expect(final.outcome).toBeUndefined();
      expect(final.finalPrice).toBeUndefined();
    });

    it('does not pin evidence, so no unfrozen-looking artefact exists', async () => {
      await resolveWith(staleQuote);
      expect(ipfsPin).not.toHaveBeenCalled();
    });

    it('stamps a halt timestamp', async () => {
      const { final } = await resolveWith(staleQuote);
      expect(final.statusUpdatedAt.getTime()).toBeGreaterThan(0);
    });
  });

  describe('an illiquid price', () => {
    it('freezes the call even though the price is fresh', async () => {
      const { final } = await resolveWith({
        price: 110,
        source: 'dexscreener',
        timestamp: RESOLVED_AT_MS - 1_000,
        volume24h: 250,
      });

      expect(final.status).toBe('RESOLUTION_HALTED');
      expect(final.resolutionHaltedReason).toContain('24h volume');
    });
  });

  describe('the GeckoTerminal fallback', () => {
    it('freezes when the fallback feed has no volume to report', async () => {
      // The simple-price endpoint publishes a price and a timestamp but no
      // volume, so falling back to it means the market cannot be shown to be
      // liquid. It must freeze rather than settle on unverified depth.
      const { final } = await resolveWith({
        price: 110,
        source: 'geckoterminal',
        timestamp: RESOLVED_AT_MS - 1_000,
      });

      expect(final.status).toBe('RESOLUTION_HALTED');
      expect(final.resolutionHaltedReason).toContain('no 24h volume');
    });
  });

  describe('alerting the operator', () => {
    it('posts a Discord alert with the call context', async () => {
      await resolveWith({
        price: 110,
        source: 'dexscreener',
        timestamp: RESOLVED_AT_MS - (MAX_AGE + 60) * 1_000,
        volume24h: 5_000_000,
      });

      expect(globalFetch).toHaveBeenCalledWith(
        WEBHOOK,
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(globalFetch.mock.calls[0][1].body as string);
      expect(body.content).toContain('7');
      expect(body.content).toContain('0xtoken');
      expect(body.content).toContain('unfreeze-resolution');
    });

    it('emits an event so other listeners can react', async () => {
      await resolveWith({
        price: 110,
        source: 'dexscreener',
        timestamp: RESOLVED_AT_MS - (MAX_AGE + 60) * 1_000,
        volume24h: 5_000_000,
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'oracle.resolution_halted',
        expect.objectContaining({ callId: 7 }),
      );
    });

    it('still freezes when the alert cannot be delivered', async () => {
      // A webhook outage must not become a reason to settle on a bad price.
      globalFetch.mockRejectedValue(new Error('discord unreachable'));

      const { final } = await resolveWith({
        price: 110,
        source: 'dexscreener',
        timestamp: RESOLVED_AT_MS - (MAX_AGE + 60) * 1_000,
        volume24h: 5_000_000,
      });

      expect(final.status).toBe('RESOLUTION_HALTED');
    });

    it('still freezes when no webhook is configured at all', async () => {
      Reflect.set(
        service,
        'configService',
        { get: (k: string, d?: unknown) => (k === 'DISCORD_ADMIN_WEBHOOK_URL' ? null : d ?? null) },
      );

      const { final } = await resolveWith({
        price: 110,
        source: 'dexscreener',
        timestamp: RESOLVED_AT_MS - (MAX_AGE + 60) * 1_000,
        volume24h: 5_000_000,
      });

      expect(final.status).toBe('RESOLUTION_HALTED');
      expect(globalFetch).not.toHaveBeenCalled();
    });
  });

  describe('the audit trail', () => {
    it('writes a halt entry with the violations attached', async () => {
      await resolveWith({
        price: 110,
        source: 'dexscreener',
        timestamp: RESOLVED_AT_MS - (MAX_AGE + 60) * 1_000,
        volume24h: 5_000_000,
      });

      const halt = manager.save.mock.calls.find(
        ([entity]) => entity === AuditLog,
      );
      expect(halt).toBeDefined();
      const [, entry] = halt as [unknown, Record<string, any>];
      expect(entry.action).toBe(AuditLogAction.ORACLE_RESOLUTION_HALTED);
      expect(entry.actor).toBe('oracle-worker');
      expect(entry.targetResource).toBe('call:7');
      expect(entry.payload.violations[0].reason).toBe('stale-timestamp');
    });
  });

  describe('a frozen call is not re-picked by later sweeps', () => {
    it('only ever claims OPEN calls', async () => {
      await service.resolveDueCalls();
      const [sql] = manager.query.mock.calls[0];
      expect(sql).toContain("status = 'OPEN'");
    });
  });

  describe('degradation', () => {
    it('skips the guard entirely when the staleness service is absent', async () => {
      // Keeps a deployment that has not wired the provider resolving, rather
      // than failing every call. The guard is opt-in at the DI level.
      Reflect.set(service, 'priceStaleness', undefined);

      const { final } = await resolveWith({
        price: 110,
        source: 'dexscreener',
        timestamp: RESOLVED_AT_MS - (MAX_AGE + 60) * 1_000,
        volume24h: 1,
      });

      expect(final.status).toBe('SETTLED');
    });
  });

  describe('price feed outage', () => {
    it('marks UNRESOLVED rather than halting, since the cause is different', async () => {
      manager.query.mockResolvedValue([makeCall()]);
      jest
        .spyOn(service, 'fetchPriceWithFallback')
        .mockRejectedValue(new Error('both feeds exhausted'));

      const results = await service.resolveDueCalls();
      expect(results[0].status).toBe('UNRESOLVED');
    });
  });

  describe('staleness service integration', () => {
    it('is the same instance the oracle was given', () => {
      expect((service as never as { priceStaleness: unknown }).priceStaleness).toBe(
        staleness,
      );
    });
  });
});
