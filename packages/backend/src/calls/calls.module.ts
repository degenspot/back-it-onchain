import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { DisputeService } from './dispute.service';
import { DisputeController } from './dispute.controller';
import { Call } from './call.entity';
import { Participant } from './participant.entity';
import { StakeActivity } from './stake-activity.entity';
import { Dispute } from './dispute.entity';
import { DisputeStake } from './dispute-stake.entity';
import { DisputeEvidence } from './dispute-evidence.entity';
import { DisputeApproval } from './dispute-approval.entity';
import { CallsCleanupService } from './calls-cleanup.service';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { IpfsModule } from '../ipfs/ipfs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Call,
      Participant,
      StakeActivity,
      Dispute,
      DisputeStake,
      DisputeEvidence,
      DisputeApproval,
    ]),
    AdminModule,
    AuthModule,
    IpfsModule,
    // BE-019's dispute sweeper is an @Interval, which needs ScheduleModule --
    // but AppModule already calls ScheduleModule.forRoot(), and forRoot()
    // registers a scheduler root. Importing it a second time risks two roots
    // fighting over the same @Interval decorators, so the root stays in one
    // place and this module just declares the dependency.
    ScheduleModule,
  ],
  providers: [CallsService, CallsCleanupService, DisputeService],
  controllers: [CallsController, DisputeController],
  exports: [CallsService, DisputeService],
})
export class CallsModule {}
