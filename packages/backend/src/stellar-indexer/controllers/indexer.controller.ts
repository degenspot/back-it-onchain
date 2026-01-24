import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MultiChainIndexerService } from '../services/multi-chain-indexer.service';
import { StellarIndexerService } from '../services/stellar-indexer.service';
import { BaseIndexerService } from '../services/base-indexer.service';

@Controller('indexer')
export class IndexerController {
  constructor(
    private readonly multiChainIndexer: MultiChainIndexerService,
    private readonly stellarIndexer: StellarIndexerService,
    private readonly baseIndexer: BaseIndexerService,
  ) {}

  @Post('stellar/initialize')
  async initializeStellarIndexer(config) {
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
  async getStellarEventsByType(eventType) {
    return this.stellarIndexer.getEventsByType(eventType);
  }

  @Get('stellar/events/contract/:contractId')
  async getStellarEventsByContract(contractId) {
    return this.stellarIndexer.getEventsByContract(contractId);
  }

  @Get('stellar/stats')
  async getStellarStats() {
    return this.stellarIndexer.getStellarEventStats();
  }

  @Get('base/events/contract/:contractAddress')
  async getBaseEventsByContract(contractAddress) {
    return this.baseIndexer.getEventsByContract(contractAddress);
  }

  @Get('base/stats')
  async getBaseStats() {
    return this.baseIndexer.getBaseEventStats();
  }
}
