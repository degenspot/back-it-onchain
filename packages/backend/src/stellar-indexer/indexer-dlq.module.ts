import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IndexerDlqService } from './services/indexer-dlq.service';

@Module({
  imports: [ConfigModule],
  providers: [IndexerDlqService],
  exports: [IndexerDlqService],
})
export class IndexerDlqModule {}
