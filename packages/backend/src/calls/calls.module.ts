import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { Call } from './call.entity';
import { CallsCleanupService } from './calls-cleanup.service';

@Module({
  imports: [TypeOrmModule.forFeature([Call])],
  providers: [CallsService, CallsCleanupService],
  controllers: [CallsController],
})
export class CallsModule {}
