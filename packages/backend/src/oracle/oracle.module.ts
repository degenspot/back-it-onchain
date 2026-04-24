import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OracleService } from './oracle.service';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [ConfigModule, AdminModule],
  providers: [OracleService],
  exports: [OracleService],
})
export class OracleModule {}
