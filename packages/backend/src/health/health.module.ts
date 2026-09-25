/**
 * health.module.ts  (BE-004 updated)
 *
 * Exposes liveness (/health), readiness (/health/ready),
 * and indexer lock status (/health/indexer) endpoints.
 */
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { CacheHealthIndicator } from './indicators/cache.health-indicator';
import { RpcHealthIndicator } from './indicators/rpc.health-indicator';
import { RpcModule } from '../config/rpc.module';
import { IndexerLockService } from '../stellar-indexer/services/indexer-lock.service';
import { RedisClientProvider } from '../config/redis.config';

@Module({
  imports: [TerminusModule, ConfigModule, RpcModule],
  controllers: [HealthController],
  providers: [
    CacheHealthIndicator,
    RpcHealthIndicator,
    RedisClientProvider,
    IndexerLockService,
  ],
  exports: [IndexerLockService],
})
export class HealthModule {}
