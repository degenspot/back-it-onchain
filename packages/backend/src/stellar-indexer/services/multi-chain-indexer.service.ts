import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { StellarIndexerService } from './stellar-indexer.service';
import { BaseIndexerService } from './base-indexer.service';

export interface MultiChainIndexerConfig {
  enableBase?: boolean;
  enableStellar?: boolean;
  stellar?: {
    rpcUrl: string;
    contractIds: string[];
    pollIntervalMs?: number;
    startLedger?: number;
  };
  base?: {
    rpcUrl: string;
    contractAddress: string;
    pollIntervalMs?: number;
    startBlock?: number;
  };
}

@Injectable()
export class MultiChainIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MultiChainIndexerService.name);
  private config: MultiChainIndexerConfig;
  private isRunning = false;

  constructor(
    private readonly stellarIndexer: StellarIndexerService,
    private readonly baseIndexer: BaseIndexerService,
  ) {}

  async initialize(config: MultiChainIndexerConfig): Promise<void> {
    this.config = {
      enableBase: true,
      enableStellar: true,
      ...config,
    };

    this.logger.log('Initializing Multi-Chain Indexer...');

    if (this.config.enableStellar && this.config.stellar) {
      this.logger.log('Initializing Stellar indexer...');
      await this.stellarIndexer.initialize({
        rpcUrl: this.config.stellar.rpcUrl,
        contractIds: this.config.stellar.contractIds,
        pollIntervalMs: this.config.stellar.pollIntervalMs,
        startLedger: this.config.stellar.startLedger,
      });
    }

    if (this.config.enableBase && this.config.base) {
      this.logger.log('Initializing Base indexer...');
      await this.baseIndexer.initialize({
        rpcUrl: this.config.base.rpcUrl,
        contractAddress: this.config.base.contractAddress,
        pollIntervalMs: this.config.base.pollIntervalMs,
        startBlock: this.config.base.startBlock,
      });
    }

    this.logger.log('Multi-Chain Indexer initialized successfully');
  }

  async onModuleInit(): Promise<void> {
    if (!this.config) {
      this.logger.warn(
        'MultiChainIndexerService not initialized. Call initialize() first.',
      );
      return;
    }

    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Multi-Chain Indexer is already running');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting Multi-Chain Indexer...');

    const startPromises = [];

    if (this.config.enableStellar) {
      startPromises.push(
        this.stellarIndexer.start().catch((error) => {
          this.logger.error('Failed to start Stellar indexer:', error);
        }),
      );
    }

    if (this.config.enableBase) {
      startPromises.push(
        this.baseIndexer.start().catch((error) => {
          this.logger.error('Failed to start Base indexer:', error);
        }),
      );
    }

    await Promise.allSettled(startPromises);

    this.logger.log('Multi-Chain Indexer started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.logger.log('Stopping Multi-Chain Indexer...');

    const stopPromises = [];

    if (this.config.enableStellar) {
      stopPromises.push(
        this.stellarIndexer.stop().catch((error) => {
          this.logger.error('Error stopping Stellar indexer:', error);
        }),
      );
    }

    if (this.config.enableBase) {
      stopPromises.push(
        this.baseIndexer.stop().catch((error) => {
          this.logger.error('Error stopping Base indexer:', error);
        }),
      );
    }

    await Promise.allSettled(stopPromises);

    this.logger.log('Multi-Chain Indexer stopped');
  }

  isRunning$(): boolean {
    return this.isRunning;
  }

  getStatus(): {
    isRunning: boolean;
    stellarEnabled: boolean;
    baseEnabled: boolean;
  } {
    return {
      isRunning: this.isRunning,
      stellarEnabled: this.config.enableStellar,
      baseEnabled: this.config.enableBase,
    };
  }
}
