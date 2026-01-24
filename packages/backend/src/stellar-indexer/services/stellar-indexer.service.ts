import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SorobanRpc } from '@stellar/stellar-sdk';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Call, ChainType } from '../entities/call.entity';

export interface StellarIndexerConfig {
  rpcUrl: string;
  contractIds: string[];
  pollIntervalMs?: number;
  startLedger?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface ParsedSorobanEvent {
  type: string;
  contractId: string;
  ledger: number;
  txHash: string;
  sequence: number;
  data: Record<string, any>;
}

@Injectable()
export class StellarIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StellarIndexerService.name);
  private sorobanRpc: SorobanRpc.Server;
  private pollInterval: NodeJS.Timer;
  private isRunning = false;
  private currentLedger: number;
  private config: StellarIndexerConfig;
  private callRepository: Repository<Call>;

  constructor(callRepository: Repository<Call>) {
    this.callRepository = callRepository;
  }

  async initialize(config: StellarIndexerConfig): Promise<void> {
    this.config = {
      pollIntervalMs: 12000, // ~1 ledger on Stellar = 5-12 seconds
      maxRetries: 3,
      retryDelayMs: 5000,
      ...config,
    };

    this.sorobanRpc = new SorobanRpc.Server(this.config.rpcUrl);
    this.currentLedger = this.config.startLedger || 1;

    this.logger.log(
      `Stellar Indexer initialized with RPC: ${this.config.rpcUrl}`,
    );
    this.logger.log(`Monitoring contracts: ${this.config.contractIds.join(', ')}`);
  }

  async onModuleInit(): Promise<void> {
    if (!this.config) {
      this.logger.warn(
        'StellarIndexerService not initialized. Call initialize() first.',
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
      this.logger.warn('Stellar indexer is already running');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting Stellar Indexer...');

    // Get the latest ledger as starting point if not specified
    if (!this.config.startLedger) {
      try {
        const latestLedger = await this.sorobanRpc.getLatestLedger();
        this.currentLedger = latestLedger.sequence - 100; // Start from 100 ledgers back
      } catch (error) {
        this.logger.error('Failed to fetch latest ledger:', error);
        this.currentLedger = 1;
      }
    }

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

    this.logger.log('Stellar Indexer stopped');
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

  private async fetchAndProcessEvents(
    retryCount = 0,
  ): Promise<void> {
    try {
      const latestLedger = await this.sorobanRpc.getLatestLedger();
      const toLedger = latestLedger.sequence;

      if (this.currentLedger > toLedger) {
        this.logger.debug('No new ledgers to process');
        return;
      }

      this.logger.debug(
        `Fetching events from ledger ${this.currentLedger} to ${toLedger}`,
      );

      for (const contractId of this.config.contractIds) {
        await this.fetchContractEvents(contractId, this.currentLedger, toLedger);
      }

      this.currentLedger = toLedger + 1;
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

  private async fetchContractEvents(
    contractId: string,
    startLedger: number,
    endLedger: number,
  ): Promise<void> {
    try {
      const events = await this.sorobanRpc.getEvents({
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [contractId],
          },
        ],
      });

      if (!events.events || events.events.length === 0) {
        this.logger.debug(`No events found for contract ${contractId}`);
        return;
      }

      this.logger.debug(
        `Found ${events.events.length} events for contract ${contractId}`,
      );

      for (const event of events.events) {
        try {
          const parsedEvent = this.parseEvent(event, contractId);
          await this.storeEvent(parsedEvent);
        } catch (error) {
          this.logger.error(
            `Error parsing event for contract ${contractId}:`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error fetching events for contract ${contractId}:`,
        error,
      );
    }
  }

  private parseEvent(
    event: SorobanRpc.EventResponse,
    contractId: string,
  ): ParsedSorobanEvent {
    try {
      // Extract XDR data
      const eventXdr = event.type === 'contract' ? event.contract : null;
      if (!eventXdr) {
        throw new Error('Invalid event structure');
      }

      // Decode the event topics and data
      const topics: StellarSdk.xdr.ScVal[] = [];
      const data: StellarSdk.xdr.ScVal[] = [];

      // Parse topics
      if (eventXdr.topics && eventXdr.topics.length > 0) {
        for (const topic of eventXdr.topics) {
          topics.push(StellarSdk.xdr.ScVal.fromXDR(topic, 'base64'));
        }
      }

      // Parse data
      if (eventXdr.data) {
        data.push(StellarSdk.xdr.ScVal.fromXDR(eventXdr.data, 'base64'));
      }

      // Determine event type from topics
      const eventType = this.getEventType(topics);

      // Decode the data payload
      const decodedData = this.decodeEventData(topics, data);

      return {
        type: eventType,
        contractId,
        ledger: event.ledger,
        txHash: event.txHash,
        sequence: event.id.split('-')[1] ? parseInt(event.id.split('-')[1]) : 0,
        data: decodedData,
      };
    } catch (error) {
      this.logger.error('Error parsing Soroban event:', error);
      throw error;
    }
  }

  private getEventType(topics: StellarSdk.xdr.ScVal[]): string {
    // The first topic typically contains the event type as a symbol
    if (topics.length === 0) {
      return 'Unknown';
    }

    const topicType = topics[0].switch();

    if (topicType === StellarSdk.xdr.ScValType.scvTypeSymbol()) {
      const symbol = topics[0].sym().toString('utf-8');
      return this.mapEventTypeName(symbol);
    }

    return 'Unknown';
  }

  private mapEventTypeName(rawName: string): string {
    // Map Soroban event names to standardized names
    const nameMap: Record<string, string> = {
      CallCreated: 'CallCreated',
      StakeAdded: 'StakeAdded',
      OutcomeSubmitted: 'OutcomeSubmitted',
      // Add more mappings as needed
    };

    return nameMap[rawName] || rawName;
  }

  private decodeEventData(
    topics: StellarSdk.xdr.ScVal[],
    data: StellarSdk.xdr.ScVal[],
  ): Record<string, any> {
    const decoded: Record<string, any> = {};

    try {
      // Decode topics (skip first topic which is the event type)
      for (let i = 1; i < topics.length; i++) {
        decoded[`topic_${i}`] = this.decodeScVal(topics[i]);
      }

      // Decode data
      for (let i = 0; i < data.length; i++) {
        decoded[`data_${i}`] = this.decodeScVal(data[i]);
      }
    } catch (error) {
      this.logger.error('Error decoding event data:', error);
    }

    return decoded;
  }

  private decodeScVal(scVal: StellarSdk.xdr.ScVal): any {
    const type = scVal.switch();

    switch (type) {
      case StellarSdk.xdr.ScValType.scvTypeU32():
        return scVal.u32().toString();

      case StellarSdk.xdr.ScValType.scvTypeU64():
        return scVal.u64().toString();

      case StellarSdk.xdr.ScValType.scvTypeI32():
        return scVal.i32().toString();

      case StellarSdk.xdr.ScValType.scvTypeI64():
        return scVal.i64().toString();

      case StellarSdk.xdr.ScValType.scvTypeSymbol():
        return scVal.sym().toString('utf-8');

      case StellarSdk.xdr.ScValType.scvTypeBytes():
        return scVal.bytes().toString('hex');

      case StellarSdk.xdr.ScValType.scvTypeAddress():
        const addr = scVal.address();
        return addr.switch().name === 'ScAddressTypeAccountId'
          ? StellarSdk.StrKey.encodeEd25519PublicKey(
              addr.accountId().ed25519().buffer,
            )
          : addr.contractId().toString('hex');

      case StellarSdk.xdr.ScValType.scvTypeVec():
        return scVal.vec().map((v) => this.decodeScVal(v));

      case StellarSdk.xdr.ScValType.scvTypeMap():
        const map: Record<string, any> = {};
        const entries = scVal.map();
        if (entries) {
          for (const entry of entries) {
            const key = this.decodeScVal(entry.key());
            const value = this.decodeScVal(entry.val());
            map[key] = value;
          }
        }
        return map;

      case StellarSdk.xdr.ScValType.scvTypeBool():
        return scVal.b();

      default:
        return null;
    }
  }

  private async storeEvent(parsedEvent: ParsedSorobanEvent): Promise<void> {
    try {
      // Check if event already exists
      const existing = await this.callRepository.findOne({
        where: {
          chain: ChainType.STELLAR,
          txHash: parsedEvent.txHash,
          eventSequence: parsedEvent.sequence,
        },
      });

      if (existing) {
        this.logger.debug(
          `Event already indexed: ${parsedEvent.txHash}:${parsedEvent.sequence}`,
        );
        return;
      }

      const call = this.callRepository.create({
        chain: ChainType.STELLAR,
        txHash: parsedEvent.txHash,
        stellarContractId: parsedEvent.contractId,
        contractId: parsedEvent.contractId,
        eventType: parsedEvent.type,
        ledgerHeight: parsedEvent.ledger,
        eventSequence: parsedEvent.sequence,
        eventData: parsedEvent.data,
      });

      await this.callRepository.save(call);

      this.logger.log(
        `Stored Stellar event: ${parsedEvent.type} from contract ${parsedEvent.contractId}`,
      );
    } catch (error) {
      this.logger.error('Error storing event:', error);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Utility methods for external use

  async getEventsByType(eventType: string): Promise<Call[]> {
    return this.callRepository.find({
      where: {
        chain: ChainType.STELLAR,
        eventType,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async getEventsByContract(contractId: string): Promise<Call[]> {
    return this.callRepository.find({
      where: {
        chain: ChainType.STELLAR,
        contractId,
      },
      order: {
        ledgerHeight: 'DESC',
      },
    });
  }

  async getStellarEventStats(): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    lastIndexedLedger: number;
  }> {
    const events = await this.callRepository.find({
      where: {
        chain: ChainType.STELLAR,
      },
    });

    const eventsByType: Record<string, number> = {};
    for (const event of events) {
      eventsByType[event.eventType] =
        (eventsByType[event.eventType] || 0) + 1;
    }

    return {
      totalEvents: events.length,
      eventsByType,
      lastIndexedLedger: this.currentLedger,
    };
  }
}
