import { Controller, Get, Injectable, Res } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Prometheus metrics exporter (BE-041).
 *
 * Implements a minimal, dependency-free Prometheus text-exposition-format
 * encoder rather than adding the `prom-client` package, so this stays a
 * single-file addition. Exposes the four metrics named in the issue:
 * `stellar_indexer_ledger_height`, `oracle_resolution_duration_seconds`,
 * `active_websocket_connections`, `failed_jobs_total`.
 */

interface HistogramBucket {
  le: number;
  count: number;
}

/** Cumulative histogram with a fixed set of upper bounds (seconds). */
class Histogram {
  private readonly bucketBounds: number[];
  private readonly buckets: HistogramBucket[];
  private sum = 0;
  private count = 0;

  constructor(bucketBounds: number[]) {
    this.bucketBounds = [...bucketBounds].sort((a, b) => a - b);
    this.buckets = this.bucketBounds.map((le) => ({ le, count: 0 }));
  }

  observe(value: number): void {
    this.sum += value;
    this.count += 1;
    for (const bucket of this.buckets) {
      if (value <= bucket.le) {
        bucket.count += 1;
      }
    }
  }

  /** Cumulative bucket counts, +Inf last, per Prometheus histogram semantics. */
  cumulativeBuckets(): HistogramBucket[] {
    return [...this.buckets, { le: Infinity, count: this.count }];
  }

  getSum(): number {
    return this.sum;
  }

  getCount(): number {
    return this.count;
  }
}

@Injectable()
export class MetricsService {
  private indexerLedgerHeight = 0;
  private activeWebsocketConnections = 0;
  private failedJobsTotal = 0;
  private readonly oracleResolutionDuration = new Histogram([
    0.1, 0.5, 1, 2, 5, 10, 30, 60,
  ]);

  setIndexerLedgerHeight(height: number): void {
    this.indexerLedgerHeight = height;
  }

  setActiveWebsocketConnections(count: number): void {
    this.activeWebsocketConnections = count;
  }

  incrementFailedJobs(by = 1): void {
    this.failedJobsTotal += by;
  }

  observeOracleResolutionDuration(seconds: number): void {
    this.oracleResolutionDuration.observe(seconds);
  }

  /** Render all metrics in Prometheus text exposition format (v0.0.4). */
  exposition(): string {
    const lines: string[] = [];

    lines.push('# HELP stellar_indexer_ledger_height Latest ledger sequence processed by the indexer.');
    lines.push('# TYPE stellar_indexer_ledger_height gauge');
    lines.push(`stellar_indexer_ledger_height ${this.indexerLedgerHeight}`);

    lines.push('# HELP active_websocket_connections Number of currently open websocket connections.');
    lines.push('# TYPE active_websocket_connections gauge');
    lines.push(`active_websocket_connections ${this.activeWebsocketConnections}`);

    lines.push('# HELP failed_jobs_total Total number of background jobs that have failed.');
    lines.push('# TYPE failed_jobs_total counter');
    lines.push(`failed_jobs_total ${this.failedJobsTotal}`);

    lines.push('# HELP oracle_resolution_duration_seconds Time taken to resolve a call outcome via the oracle.');
    lines.push('# TYPE oracle_resolution_duration_seconds histogram');
    for (const bucket of this.oracleResolutionDuration.cumulativeBuckets()) {
      const le = bucket.le === Infinity ? '+Inf' : bucket.le;
      lines.push(`oracle_resolution_duration_seconds_bucket{le="${le}"} ${bucket.count}`);
    }
    lines.push(`oracle_resolution_duration_seconds_sum ${this.oracleResolutionDuration.getSum()}`);
    lines.push(`oracle_resolution_duration_seconds_count ${this.oracleResolutionDuration.getCount()}`);

    return lines.join('\n') + '\n';
  }
}

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  getMetrics(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(this.metricsService.exposition());
  }
}
