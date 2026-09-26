import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  RpcCircuitBreakerService,
  LEDGER_PROBE,
  type LedgerProbe,
} from './rpc-circuit-breaker.service';
import type { StellarRpcConfig } from '../../config/stellar.config';

const PRIMARY = 'https://primary.example';
const FALLBACK = 'https://fallback.example';

function config(overrides: Partial<StellarRpcConfig> = {}): StellarRpcConfig {
  return {
    primaryUrl: PRIMARY,
    fallbackUrls: [FALLBACK],
    probeIntervalMs: 10_000,
    probeTimeoutMs: 100,
    errorThresholdPercentage: 20,
    resetTimeoutMs: 50,
    volumeThreshold: 1,
    maxLedgerLag: 100,
    ...overrides,
  };
}

async function build(
  probe: LedgerProbe,
  cfg: StellarRpcConfig = config(),
): Promise<RpcCircuitBreakerService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RpcCircuitBreakerService,
      { provide: ConfigService, useValue: { get: () => cfg } },
      { provide: LEDGER_PROBE, useValue: probe },
    ],
  }).compile();

  const service = module.get(RpcCircuitBreakerService);
  service.onModuleInit();
  return service;
}

describe('RpcCircuitBreakerService', () => {
  let service: RpcCircuitBreakerService | undefined;

  afterEach(() => {
    service?.onModuleDestroy();
    service = undefined;
  });

  describe('endpoint selection', () => {
    it('prefers the primary while it is healthy', async () => {
      service = await build(async () => 100);
      await service.probeAll();
      expect(service.activeEndpoint()).toBe(PRIMARY);
      expect(service.isAvailable()).toBe(true);
    });

    it('falls back when the primary fails', async () => {
      service = await build(async (url) => {
        if (url === PRIMARY) throw new Error('primary down');
        return 100;
      });

      await service.probeAll();

      expect(service.activeEndpoint()).toBe(FALLBACK);
      expect(service.isAvailable()).toBe(true);
    });

    it('reports nothing available when every endpoint fails', async () => {
      service = await build(async () => {
        throw new Error('all down');
      });

      await service.probeAll();

      expect(service.activeEndpoint()).toBeNull();
      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('circuit breaking', () => {
    it('opens the circuit after repeated failures', async () => {
      service = await build(async (url) => {
        if (url === PRIMARY) throw new Error('primary down');
        return 100;
      });

      for (let i = 0; i < 5; i++) await service.probeAll();

      const primary = service.snapshot().find((e) => e.url === PRIMARY);
      expect(primary?.state).toBe('open');
      expect(primary?.healthy).toBe(false);
    });

    it('half-opens and closes again once the endpoint recovers', async () => {
      let healthy = false;
      service = await build(
        async (url) => {
          if (url === PRIMARY && !healthy) throw new Error('primary down');
          return 100;
        },
        config({ resetTimeoutMs: 20 }),
      );

      for (let i = 0; i < 5; i++) await service.probeAll();
      expect(service.snapshot().find((e) => e.url === PRIMARY)?.state).toBe('open');

      // Let the reset timeout elapse, then recover the endpoint.
      healthy = true;
      await new Promise((r) => setTimeout(r, 40));
      await service.probeAll();

      const primary = service.snapshot().find((e) => e.url === PRIMARY);
      expect(primary?.state).toBe('closed');
      expect(primary?.healthy).toBe(true);
      expect(service.activeEndpoint()).toBe(PRIMARY);
    });

    it('keeps one endpoint failing from tripping the others', async () => {
      service = await build(async (url) => {
        if (url === PRIMARY) throw new Error('primary down');
        return 100;
      });

      for (let i = 0; i < 5; i++) await service.probeAll();

      const fallback = service.snapshot().find((e) => e.url === FALLBACK);
      expect(fallback?.state).toBe('closed');
      expect(fallback?.healthy).toBe(true);
    });
  });

  describe('ledger staleness', () => {
    it('marks a responsive but lagging endpoint unhealthy', async () => {
      service = await build(
        async (url) => (url === PRIMARY ? 1_000 : 5_000),
        config({ maxLedgerLag: 100 }),
      );

      await service.probeAll();

      const primary = service.snapshot().find((e) => e.url === PRIMARY);
      expect(primary?.ledgerLag).toBe(4_000);
      expect(primary?.healthy).toBe(false);
      // Traffic moves to the node that is actually caught up.
      expect(service.activeEndpoint()).toBe(FALLBACK);
    });

    it('tolerates lag within the configured allowance', async () => {
      service = await build(
        async (url) => (url === PRIMARY ? 4_950 : 5_000),
        config({ maxLedgerLag: 100 }),
      );

      await service.probeAll();

      const primary = service.snapshot().find((e) => e.url === PRIMARY);
      expect(primary?.ledgerLag).toBe(50);
      expect(primary?.healthy).toBe(true);
      expect(service.activeEndpoint()).toBe(PRIMARY);
    });
  });

  describe('metrics', () => {
    it('exposes counters and per-endpoint gauges in Prometheus format', async () => {
      service = await build(async (url) => {
        if (url === PRIMARY) throw new Error('down');
        return 100;
      });
      await service.probeAll();

      const text = service.toPrometheus();

      expect(text).toContain('# TYPE soroban_rpc_probes_total counter');
      expect(text).toContain('soroban_rpc_probe_failures_total 1');
      expect(text).toContain(`soroban_rpc_endpoint_up{endpoint="${PRIMARY}"} 0`);
      expect(text).toContain(`soroban_rpc_endpoint_up{endpoint="${FALLBACK}"} 1`);
      expect(text.endsWith('\n')).toBe(true);
    });

    it('counts failovers when noted', async () => {
      service = await build(async () => 100);
      service.noteFailover();
      expect(service.toPrometheus()).toContain('soroban_rpc_failovers_total 1');
    });
  });

  describe('configuration', () => {
    it('de-duplicates an endpoint listed as both primary and fallback', async () => {
      service = await build(
        async () => 100,
        config({ fallbackUrls: [PRIMARY, FALLBACK] }),
      );
      expect(service.endpoints()).toEqual([PRIMARY, FALLBACK]);
    });

    it('works with no fallbacks configured', async () => {
      service = await build(async () => 100, config({ fallbackUrls: [] }));
      await service.probeAll();
      expect(service.endpoints()).toEqual([PRIMARY]);
      expect(service.activeEndpoint()).toBe(PRIMARY);
    });
  });
});
