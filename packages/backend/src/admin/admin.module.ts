import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSettings } from '../indexer/platform-settings.entity';
import { AuditLog } from '../oracle/audit-log.entity';
import { AuditLogService } from '../oracle/audit-log.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CallsModule } from '../calls/calls.module';
import { PaymasterPolicyService } from '../oracle/paymaster-policy.service';
import { IndexerDlqModule } from '../stellar-indexer/indexer-dlq.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([PlatformSettings, AuditLog]),
    forwardRef(() => CallsModule),
    IndexerDlqModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, PaymasterPolicyService, AuditLogService],
  exports: [AdminService, PaymasterPolicyService, AuditLogService],
})
export class AdminModule {}
