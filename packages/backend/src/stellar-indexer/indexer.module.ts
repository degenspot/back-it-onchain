/**
 * indexer.module.ts  (BE-001 / BE-002 / BE-003)
 *
 * Wires all stellar-indexer services and registers TypeORM entities.
 * SorobanRpcClient and EventEmitter2 are global providers from
 * RpcModule / EventEmitterModule (both imported in AppModule).
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Call } from './entities/call.entity';
import { LedgerCheckpointEntity } from './entities/ledger-checkpoint.entity';
import { OutcomePool } from './entities/outcome-pool.entity';
import { ParticipantStake } from './entities/participant-stake.entity';
import { StakeActivity } from '../calls/stake-activity.entity';

import { StellarIndexerService } from './services/stellar-indexer.service';
import { BaseIndexerService } from './services/base-indexer.service';
import { MultiChainIndexerService } from './services/multi-chain-indexer.service';
import { LedgerCheckpointService } from './services/ledger-checkpoint.service';
import { CallEventStoreService } from './services/call-event-store.service';
import { MultiOutcomeEventService } from './services/multi-outcome-event.service';
import { IndexerController } from './controllers/indexer.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Call,
      LedgerCheckpointEntity,
      OutcomePool,
      ParticipantStake,
      StakeActivity,
    ]),
  ],
  providers: [
    StellarIndexerService,
    BaseIndexerService,
    MultiChainIndexerService,
    LedgerCheckpointService,
    CallEventStoreService,
    MultiOutcomeEventService,
  ],
  controllers: [IndexerController],
  exports: [
    StellarIndexerService,
    BaseIndexerService,
    MultiChainIndexerService,
    LedgerCheckpointService,
    CallEventStoreService,
    MultiOutcomeEventService,
  ],
})
export class IndexerModule {}
