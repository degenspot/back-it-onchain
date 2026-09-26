import { Controller, Get, Post, Body, Param, Header } from '@nestjs/common';
import { MultiChainIndexerService } from '../services/multi-chain-indexer.service';
import { StellarIndexerService } from '../services/stellar-indexer.service';
import { BaseIndexerService } from '../services/base-indexer.service';
import { RpcCircuitBreakerService } from '../services/rpc-circuit-breaker.service';
import { BulkEventLoaderService } from '../services/bulk-event-loader.service';

@Controller('indexer')
export class IndexerController {
  constructor(
    private readonly multiChainIndexer: MultiChainIndexerService,
    private readonly stellarIndexer: StellarIndexerService,
    private readonly baseIndexer: BaseIndexerService,
    private readonly rpcCircuitBreaker: RpcCircuitBreakerService,
    private readonly bulkEventLoader: BulkEventLoaderService,
  ) {}

  /**
   * Per-endpoint RPC health (BE-007). Shows which endpoint is currently
   * serving, each breaker's state, and how far behind each node is.
   */
  @Get('rpc/health')
  getRpcHealth() {
    return {
      available: this.rpcCircuitBreaker.isAvailable(),
      activeEndpoint: this.rpcCircuitBreaker.activeEndpoint(),
      endpoints: this.rpcCircuitBreaker.snapshot(),
    };
  }

  /** Prometheus scrape target for the RPC breaker metrics (BE-007). */
  @Get('rpc/metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  getRpcMetrics(): string {
    return this.rpcCircuitBreaker.toPrometheus();
  }

  @Post('stellar/initialize')
  async initializeStellarIndexer(@Body() config: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await this.stellarIndexer.initialize(config);
    return { message: 'Stellar indexer initialized' };
  }

  @Post('start')
  async startIndexers() {
    await this.multiChainIndexer.start();
    return { message: 'Multi-chain indexers started' };
  }

  @Post('stop')
  async stopIndexers() {
    await this.multiChainIndexer.stop();
    return { message: 'Multi-chain indexers stopped' };
  }

  @Get('status')
  getStatus() {
    return this.multiChainIndexer.getStatus();
  }

  @Get('stellar/events/:eventType')
  async getStellarEventsByType(@Param('eventType') eventType: string) {
    return this.stellarIndexer.getEventsByType(eventType);
  }

  @Get('stellar/events/contract/:contractId')
  async getStellarEventsByContract(@Param('contractId') contractId: string) {
    return this.stellarIndexer.getEventsByContract(contractId);
  }

  @Get('stellar/stats')
  async getStellarStats() {
    return this.stellarIndexer.getStellarEventStats();
  }

  @Get('base/events/contract/:contractAddress')
  async getBaseEventsByContract(
    @Param('contractAddress') contractAddress: string,
  ) {
    return this.baseIndexer.getEventsByContract(contractAddress);
  }

  @Get('base/stats')
  async getBaseStats() {
    return this.baseIndexer.getBaseEventStats();
  }

  /**
   * Bulk-ingest throughput counters (BE-008). Exposed so the catch-up path can
   * be observed the same way the RPC breaker is: events written per second,
   * how many were already present, and how much is sitting in the buffer.
   */
  @Get('bulk-ingest/stats')
  getBulkIngestStats() {
    return this.bulkEventLoader.getStats();
  }

  /**
   * Forces an immediate flush of the bulk-ingest buffer and reports what was
   * written. Useful for draining the tail of a catch-up without waiting out
   * the latency window.
   */
  @Post('bulk-ingest/flush')
  async flushBulkIngest() {
    const result = await this.bulkEventLoader.flush('manual');
    return {
      flushed: result !== null,
      result,
      stats: this.bulkEventLoader.getStats(),
    };
  }
}
