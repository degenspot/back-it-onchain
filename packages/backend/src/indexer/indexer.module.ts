import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IndexerService } from './indexer.service';
import { Call } from '../calls/call.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Call])],
  providers: [IndexerService],
})
export class IndexerModule { }
