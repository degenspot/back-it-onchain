import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Call } from './entities/call.entity';
import { StellarIndexerService } from './services/stellar-indexer.service';
import { BaseIndexerService } from './services/base-indexer.service';
import { MultiChainIndexerService } from './services/multi-chain-indexer.service';
import { IndexerController } from './controllers/indexer.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Call])],
  providers: [
    StellarIndexerService,
    BaseIndexerService,
    MultiChainIndexerService,
  ],
  controllers: [IndexerController],
  exports: [
    StellarIndexerService,
    BaseIndexerService,
    MultiChainIndexerService,
  ],
})
export class IndexerModule {}
