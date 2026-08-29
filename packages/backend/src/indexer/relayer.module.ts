import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelayerService } from './relayer.service';
import { AuditLog } from '../oracle/audit-log.entity';
import { Call } from '../calls/call.entity';
import { AdminModule } from '../admin/admin.module';
import { OracleModule } from '../oracle/oracle.module';

@Module({
  imports: [
    ConfigModule,
    AdminModule,
    OracleModule,
    TypeOrmModule.forFeature([AuditLog, Call]),
  ],
  providers: [RelayerService],
  exports: [RelayerService],
})
export class RelayerModule {}
