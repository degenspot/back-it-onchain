import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// opossum is CommonJS and exports the constructor as `module.exports`. This
// package sets `allowSyntheticDefaultImports` without `esModuleInterop`, so a
// default import type-checks but emits `opossum_1.default` and fails at
// runtime. The import-equals form is the correct CJS binding here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import CircuitBreaker = require('opossum');
import type { StellarRpcConfig } from '../../config/stellar.config';

export type EndpointState = 'closed' | 'open' | 'half-open';

export interface EndpointHealth {
  url: string;
  state: EndpointState;
  /** Last observed round-trip time in ms, or null if never answered. */
  latencyMs: number | null;
  /** Latest ledger this endpoint reported, or null if unknown. */
  ledger: number | null;
  /** How far behind the furthest-ahead endpoint, in ledgers. */
  ledgerLag: number | null;
  healthy: boolean;
  failures: number;
  successes: number;
  lastError?: string;
  lastProbedAt?: string;
}

/** Probes an endpoint, returning its latest ledger sequence. */
export type LedgerProbe = (url: string, timeoutMs: number) => Promise<number>;

/**
 * Injection token for the probe. Optional — the module does not provide it in
 * production, so the real network probe is used; tests override it to drive
 * endpoint behaviour deterministically instead of standing up RPC servers.
 */
export const LEDGER_PROBE = Symbol('LEDGER_PROBE');

/**
 * Active health checking and circuit breaking across Soroban RPC endpoints
 * (BE-007).
 *
 * A single RPC endpoint is a single point of failure for the whole indexing
 * loop. Worse, RPC nodes fail in two distinct ways, and only one of them looks
 * like failure: an endpoint can answer every request promptly while being
 * hundreds of ledgers behind. This treats staleness as unhealthy alongside
 * outright errors, because a confidently stale node silently corrupts indexing
 * in a way a dead node never does.
 *
 * Each endpoint gets its own opossum breaker so one bad node cannot trip the
 * others, and traffic moves to the first healthy endpoint in declared order.
 */
@Injectable()
export class RpcCircuitBreakerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RpcCircuitBreakerService.name);
  private readonly breakers = new Map<string, CircuitBreaker<[string], number>>();
  private readonly health = new Map<string, EndpointHealth>();
  private timer?: NodeJS.Timeout;
  private cfg!: StellarRpcConfig;

  /** Counters exposed as Prometheus metrics. */
  private readonly counters = {
    probesTotal: 0,
    probeFailuresTotal: 0,
    breakerOpenTotal: 0,
    failoversTotal: 0,
  };

  private readonly probe: LedgerProbe;

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(LEDGER_PROBE) probe?: LedgerProbe,
  ) {
    // Marked @Optional so Nest resolves it as undefined when unprovided; a
    // plain default parameter is invisible to the DI container and would fail
    // to instantiate the provider at runtime.
    this.probe = probe ?? defaultLedgerProbe;
  }

  onModuleInit(): void {
    this.cfg = this.resolveConfig();
    for (const url of this.endpoints()) {
      this.health.set(url, {
        url,
        state: 'closed',
        latencyMs: null,
        ledger: null,
        ledgerLag: null,
        healthy: false,
        failures: 0,
        successes: 0,
      });
      this.breakers.set(url, this.createBreaker(url));
    }
    this.startProbing();
  }

  onModuleDestroy(): void {
    this.stopProbing();
    for (const breaker of this.breakers.values()) {
      breaker.shutdown();
    }
  }

  private resolveConfig(): StellarRpcConfig {
    const fromNamespace = this.configService.get<StellarRpcConfig>('stellar');
    if (fromNamespace) return fromNamespace;
    // Fall back to defaults so the service is usable in a bare test module.
    return {
      primaryUrl: 'https://soroban-testnet.stellar.org',
      fallbackUrls: [],
      probeIntervalMs: 10_000,
      probeTimeoutMs: 3_000,
      errorThresholdPercentage: 20,
      resetTimeoutMs: 30_000,
      volumeThreshold: 5,
      maxLedgerLag: 100,
    };
  }

  /** Primary first, then declared fallbacks, de-duplicated. */
  endpoints(): string[] {
    return [...new Set([this.cfg.primaryUrl, ...this.cfg.fallbackUrls])];
  }

  private createBreaker(url: string): CircuitBreaker<[string], number> {
    const breaker = new CircuitBreaker(
      (target: string) => this.probe(target, this.cfg.probeTimeoutMs),
      {
        timeout: this.cfg.probeTimeoutMs,
        errorThresholdPercentage: this.cfg.errorThresholdPercentage,
        resetTimeout: this.cfg.resetTimeoutMs,
        volumeThreshold: this.cfg.volumeThreshold,
        name: url,
      },
    );

    breaker.on('open', () => {
      this.counters.breakerOpenTotal += 1;
      this.setState(url, 'open');
      this.logger.warn(`Circuit opened for ${url}; routing away from it`);
    });
    breaker.on('halfOpen', () => {
      this.setState(url, 'half-open');
      this.logger.log(`Circuit half-open for ${url}; trialling one request`);
    });
    breaker.on('close', () => {
      this.setState(url, 'closed');
      this.logger.log(`Circuit closed for ${url}; endpoint is serving again`);
    });

    return breaker;
  }

  private setState(url: string, state: EndpointState): void {
    const entry = this.health.get(url);
    if (entry) {
      entry.state = state;
      if (state === 'open') entry.healthy = false;
    }
  }

  private startProbing(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.probeAll();
    }, this.cfg.probeIntervalMs);
    // Do not hold the process open purely for health probes.
    this.timer.unref?.();
  }

  private stopProbing(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Probes every endpoint once and recomputes health.
   *
   * Probes run concurrently: serially, one hung endpoint would delay the
   * assessment of every other one by up to the full timeout.
   */
  async probeAll(): Promise<EndpointHealth[]> {
    await Promise.all(this.endpoints().map((url) => this.probeOne(url)));
    this.recomputeLag();
    return this.snapshot();
  }

  private async probeOne(url: string): Promise<void> {
    const entry = this.health.get(url);
    const breaker = this.breakers.get(url);
    if (!entry || !breaker) return;

    this.counters.probesTotal += 1;
    const started = Date.now();

    try {
      const ledger = await breaker.fire(url);
      entry.latencyMs = Date.now() - started;
      entry.ledger = Number.isFinite(ledger) ? ledger : null;
      entry.successes += 1;
      entry.healthy = entry.state !== 'open' && entry.ledger !== null;
      entry.lastError = undefined;
    } catch (err) {
      this.counters.probeFailuresTotal += 1;
      entry.failures += 1;
      entry.healthy = false;
      entry.latencyMs = Date.now() - started;
      entry.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      entry.lastProbedAt = new Date().toISOString();
    }
  }

  /**
   * Marks endpoints unhealthy when they lag the furthest-ahead node.
   *
   * Lag is measured against the best endpoint rather than wall-clock time,
   * because there is no other trustworthy reference for where the chain head
   * actually is.
   */
  private recomputeLag(): void {
    const ledgers = [...this.health.values()]
      .map((e) => e.ledger)
      .filter((l): l is number => typeof l === 'number');

    if (ledgers.length === 0) return;
    const best = Math.max(...ledgers);

    for (const entry of this.health.values()) {
      if (entry.ledger === null) {
        entry.ledgerLag = null;
        continue;
      }
      entry.ledgerLag = best - entry.ledger;
      if (entry.ledgerLag > this.cfg.maxLedgerLag) {
        entry.healthy = false;
      }
    }
  }

  /**
   * The endpoint traffic should use: first healthy one in declared order.
   *
   * Returns null when every endpoint is unhealthy — callers must handle that
   * rather than receive a known-bad endpoint dressed up as usable.
   */
  activeEndpoint(): string | null {
    for (const url of this.endpoints()) {
      const entry = this.health.get(url);
      if (entry?.healthy && entry.state !== 'open') return url;
    }
    return null;
  }

  /** Records that traffic moved off the primary, for metrics. */
  noteFailover(): void {
    this.counters.failoversTotal += 1;
  }

  /** True when at least one endpoint can serve traffic. */
  isAvailable(): boolean {
    return this.activeEndpoint() !== null;
  }

  snapshot(): EndpointHealth[] {
    return [...this.health.values()].map((e) => ({ ...e }));
  }

  /**
   * Metrics in Prometheus exposition format.
   *
   * Emitted directly rather than via prom-client: the repo has no metrics
   * dependency, and adding one for four counters and three gauges would be a
   * heavier change than the text format it would generate.
   */
  toPrometheus(): string {
    const lines: string[] = [
      '# HELP soroban_rpc_probes_total Health probes attempted.',
      '# TYPE soroban_rpc_probes_total counter',
      `soroban_rpc_probes_total ${this.counters.probesTotal}`,
      '# HELP soroban_rpc_probe_failures_total Health probes that failed.',
      '# TYPE soroban_rpc_probe_failures_total counter',
      `soroban_rpc_probe_failures_total ${this.counters.probeFailuresTotal}`,
      '# HELP soroban_rpc_breaker_open_total Times a circuit opened.',
      '# TYPE soroban_rpc_breaker_open_total counter',
      `soroban_rpc_breaker_open_total ${this.counters.breakerOpenTotal}`,
      '# HELP soroban_rpc_failovers_total Times traffic moved off the primary.',
      '# TYPE soroban_rpc_failovers_total counter',
      `soroban_rpc_failovers_total ${this.counters.failoversTotal}`,
      '# HELP soroban_rpc_endpoint_up Endpoint currently usable (1) or not (0).',
      '# TYPE soroban_rpc_endpoint_up gauge',
    ];

    for (const entry of this.health.values()) {
      const label = `{endpoint="${escapeLabel(entry.url)}"}`;
      lines.push(`soroban_rpc_endpoint_up${label} ${entry.healthy ? 1 : 0}`);
    }

    lines.push(
      '# HELP soroban_rpc_endpoint_latency_ms Last probe round-trip time.',
      '# TYPE soroban_rpc_endpoint_latency_ms gauge',
    );
    for (const entry of this.health.values()) {
      if (entry.latencyMs === null) continue;
      lines.push(
        `soroban_rpc_endpoint_latency_ms{endpoint="${escapeLabel(entry.url)}"} ${entry.latencyMs}`,
      );
    }

    lines.push(
      '# HELP soroban_rpc_endpoint_ledger_lag Ledgers behind the furthest-ahead endpoint.',
      '# TYPE soroban_rpc_endpoint_ledger_lag gauge',
    );
    for (const entry of this.health.values()) {
      if (entry.ledgerLag === null) continue;
      lines.push(
        `soroban_rpc_endpoint_ledger_lag{endpoint="${escapeLabel(entry.url)}"} ${entry.ledgerLag}`,
      );
    }

    return lines.join('\n') + '\n';
  }
}

/** Escapes a Prometheus label value. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Default probe: asks an endpoint for its latest ledger over JSON-RPC. */
export const defaultLedgerProbe: LedgerProbe = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestLedger',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`RPC responded ${response.status}`);
    }
    const body = (await response.json()) as {
      result?: { sequence?: number };
    };
    const sequence = body?.result?.sequence;
    if (typeof sequence !== 'number') {
      throw new Error('RPC response carried no ledger sequence');
    }
    return sequence;
  } finally {
    clearTimeout(timer);
  }
};
