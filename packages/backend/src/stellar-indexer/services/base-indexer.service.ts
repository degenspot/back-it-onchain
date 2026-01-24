import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Call, ChainType } from '../entities/call.entity';
import { InjectRepository } from '@nestjs/typeorm';

export interface BaseIndexerConfig {
  rpcUrl: string;
  contractAddress: string;
  pollIntervalMs?: number;
  startBlock?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

@Injectable()
export class BaseIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BaseIndexerService.name);
  private pollInterval: NodeJS.Timer;
  private isRunning = false;
  private currentBlock: number;
  private config: BaseIndexerConfig;

  constructor(
    private callRepository: Repository<Call>,
  ) {}

  async initialize(config: BaseIndexerConfig): Promise<void> {
    this.config = {
      pollIntervalMs: 12000,
      maxRetries: 3,
      retryDelayMs: 5000,
      ...config,
    };

    this.currentBlock = this.config.startBlock || 1;

    this.logger.log(
      `Base Indexer initialized with RPC: ${this.config.rpcUrl}`,
    );
    this.logger.log(`Monitoring contract: ${this.config.contractAddress}`);
  }

  async onModuleInit(): Promise<void> {
    if (!this.config) {
      this.logger.warn(
        'BaseIndexerService not initialized. Call initialize() first.',
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
      this.logger.warn('Base indexer is already running');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting Base Indexer...');

    this.pollForEvents();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.logger.log('Base Indexer stopped');
  }

  private pollForEvents(): void {
    this.pollInterval = setInterval(async () => {
      if (!this.isRunning) {
        return;
      }

      try {
        await this.fetchAndProcessEvents();
      } catch (error) {
        this.logger.error('Error during event polling:', error);
      }
    }, this.config.pollIntervalMs);

    // Initial poll immediately
    this.fetchAndProcessEvents().catch((error) => {
      this.logger.error('Error in initial event fetch:', error);
    });
  }

  private async fetchAndProcessEvents(retryCount = 0): Promise<void> {
    try {
      // TODO: Implement Base chain event fetching
      // This is a stub for the existing Base indexer integration
      // Implement using ethers.js or viem for Base Sepolia/mainnet

      this.logger.debug(`Base indexer polling at block ${this.currentBlock}`);
    } catch (error) {
      if (retryCount < this.config.maxRetries) {
        this.logger.warn(
          `Failed to fetch events (attempt ${retryCount + 1}/${this.config.maxRetries}), retrying...`,
        );
        await this.delay(this.config.retryDelayMs);
        return this.fetchAndProcessEvents(retryCount + 1);
      }

      this.logger.error('Max retries reached, skipping this poll cycle:', error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getEventsByContract(contractAddress: string): Promise<Call[]> {
    return this.callRepository.find({
      where: {
        chain: ChainType.BASE,
        contractId: contractAddress,
      },
      order: {
        ledgerHeight: 'DESC',
      },
    });
  }

  async getBaseEventStats(): Promise<{
    totalEvents: number;
    lastIndexedBlock: number;
  }> {
    const events = await this.callRepository.find({
      where: {
        chain: ChainType.BASE,
      },
    });

    return {
      totalEvents: events.length,
      lastIndexedBlock: this.currentBlock,
    };
  }
}
