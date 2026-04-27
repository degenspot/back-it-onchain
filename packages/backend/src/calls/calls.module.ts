import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { Call } from './call.entity';
import { Participant } from './participant.entity';
import { CallsCleanupService } from './calls-cleanup.service';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Call, Participant]), AdminModule, AuthModule],
  providers: [CallsService, CallsCleanupService],
  controllers: [CallsController],
})
export class CallsModule {}
