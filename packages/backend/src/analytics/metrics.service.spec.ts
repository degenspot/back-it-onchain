import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('exposes stellar_indexer_ledger_height as a gauge with the set value', () => {
    service.setIndexerLedgerHeight(123456);
    const output = service.exposition();
    expect(output).toContain('# TYPE stellar_indexer_ledger_height gauge');
    expect(output).toContain('stellar_indexer_ledger_height 123456');
  });

  it('exposes active_websocket_connections as a gauge with the set value', () => {
    service.setActiveWebsocketConnections(42);
    expect(service.exposition()).toContain('active_websocket_connections 42');
  });

  it('accumulates failed_jobs_total as a counter', () => {
    service.incrementFailedJobs();
    service.incrementFailedJobs(2);
    expect(service.exposition()).toContain('failed_jobs_total 3');
  });

  it('renders oracle_resolution_duration_seconds as a cumulative histogram', () => {
    service.observeOracleResolutionDuration(0.05);
    service.observeOracleResolutionDuration(1.5);
    service.observeOracleResolutionDuration(45);

    const output = service.exposition();
    expect(output).toContain(
      '# TYPE oracle_resolution_duration_seconds histogram'
    );
    // 0.05 falls in every bucket from 0.1 upward; 1.5 falls in buckets >= 2;
    // 45 falls only in the 60 bucket and +Inf.
    expect(output).toContain('oracle_resolution_duration_seconds_bucket{le="0.1"} 1');
    expect(output).toContain('oracle_resolution_duration_seconds_bucket{le="2"} 2');
    expect(output).toContain('oracle_resolution_duration_seconds_bucket{le="60"} 3');
    expect(output).toContain('oracle_resolution_duration_seconds_bucket{le="+Inf"} 3');
    expect(output).toContain('oracle_resolution_duration_seconds_sum 46.55');
    expect(output).toContain('oracle_resolution_duration_seconds_count 3');
  });

  it('produces valid Prometheus exposition format (HELP/TYPE pairs, newline-terminated)', () => {
    const output = service.exposition();
    expect(output.endsWith('\n')).toBe(true);
    const helpLines = output.split('\n').filter((l) => l.startsWith('# HELP'));
    const typeLines = output.split('\n').filter((l) => l.startsWith('# TYPE'));
    expect(helpLines.length).toBe(4);
    expect(typeLines.length).toBe(4);
  });
});
