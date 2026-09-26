/**
 * indexer.module.ts  (BE-001 / BE-002 / BE-003 / BE-004)
 *
 * Wires all stellar-indexer services and registers TypeORM entities.
 * SorobanRpcClient and EventEmitter2 are global providers from
 * RpcModule / EventEmitterModule respectively (both in AppModule).
 * IndexerLockService and RedisClientProvider are also registered here
 * so the indexer can acquire the distributed leader lock on startup.
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
import { IndexerLockService } from './services/indexer-lock.service';
import { RedisClientProvider } from '../config/redis.config';
import { DiagnosticParserService } from './services/diagnostic-parser.service';
import { RpcCircuitBreakerService } from './services/rpc-circuit-breaker.service';
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
    RedisClientProvider,
    IndexerLockService,
    StellarIndexerService,
    BaseIndexerService,
    MultiChainIndexerService,
    LedgerCheckpointService,
    CallEventStoreService,
    MultiOutcomeEventService,
    DiagnosticParserService,
    RpcCircuitBreakerService,
  ],
  controllers: [IndexerController],
  exports: [
    StellarIndexerService,
    BaseIndexerService,
    MultiChainIndexerService,
    LedgerCheckpointService,
    CallEventStoreService,
    MultiOutcomeEventService,
    IndexerLockService,
    DiagnosticParserService,
    RpcCircuitBreakerService,
  ],
})
export class IndexerModule {}
