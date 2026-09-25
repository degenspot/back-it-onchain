/**
 * indexer.module.ts  (BE-001 / BE-002)
 *
 * Wires all stellar-indexer services and registers the LedgerCheckpointEntity
 * so it is managed by TypeORM. SorobanRpcClient and EventEmitter2 are
 * global providers from RpcModule / EventEmitterModule respectively.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Call } from './entities/call.entity';
import { LedgerCheckpointEntity } from './entities/ledger-checkpoint.entity';
import { StakeActivity } from '../calls/stake-activity.entity';

import { StellarIndexerService } from './services/stellar-indexer.service';
import { BaseIndexerService } from './services/base-indexer.service';
import { MultiChainIndexerService } from './services/multi-chain-indexer.service';
import { LedgerCheckpointService } from './services/ledger-checkpoint.service';
import { CallEventStoreService } from './services/call-event-store.service';
import { IndexerController } from './controllers/indexer.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Call, LedgerCheckpointEntity, StakeActivity]),
  ],
  providers: [
    StellarIndexerService,
    BaseIndexerService,
    MultiChainIndexerService,
    LedgerCheckpointService,
    CallEventStoreService,
  ],
  controllers: [IndexerController],
  exports: [
    StellarIndexerService,
    BaseIndexerService,
    MultiChainIndexerService,
    LedgerCheckpointService,
    CallEventStoreService,
  ],
})
export class IndexerModule {}
