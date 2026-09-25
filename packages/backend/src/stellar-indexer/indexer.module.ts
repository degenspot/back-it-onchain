import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Call } from './entities/call.entity';
import { StakeActivity } from '../calls/stake-activity.entity';
import { StellarIndexerService } from './services/stellar-indexer.service';
import { BaseIndexerService } from './services/base-indexer.service';
import { MultiChainIndexerService } from './services/multi-chain-indexer.service';
import { LedgerCheckpointService } from './services/ledger-checkpoint.service';
import { CallEventStoreService } from './services/call-event-store.service';
import { DiagnosticParserService } from './services/diagnostic-parser.service';
import { RpcCircuitBreakerService } from './services/rpc-circuit-breaker.service';
import { IndexerController } from './controllers/indexer.controller';
import { IndexerDlqModule } from './indexer-dlq.module';

@Module({
  imports: [TypeOrmModule.forFeature([Call, StakeActivity]), IndexerDlqModule],
  providers: [
    StellarIndexerService,
    BaseIndexerService,
    MultiChainIndexerService,
    LedgerCheckpointService,
    CallEventStoreService,
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
    DiagnosticParserService,
    RpcCircuitBreakerService,
  ],
})
export class IndexerModule {}
