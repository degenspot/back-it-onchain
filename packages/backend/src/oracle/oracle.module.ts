import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OracleService } from './oracle.service';
import { OracleController } from './oracle.controller';
import { LedgerSchedulerService } from './ledger-scheduler.service';
import {
  BullMqLedgerQueue,
  InProcessLedgerQueue,
  LEDGER_QUEUE,
} from './ledger-queue';
import { AdminModule } from '../admin/admin.module';
import { IpfsModule } from '../ipfs/ipfs.module';
import { Call } from '../calls/call.entity';
import { AuditLog } from './audit-log.entity';
import {
  InMemoryQuorumTransport,
  QUORUM_TRANSPORT,
  QuorumConsensusService,
} from './quorum-consensus.service';
import { PriceStalenessService } from './price-staleness.service';

/**
 * Picks the ledger-expiry queue implementation.
 *
 * BullMQ whenever Redis is configured, so jobs are durable and shared between
 * replicas; the in-process timer otherwise. A single factory rather than a
 * conditional array because the choice depends on a runtime config value, and
 * it keeps the "no Redis means no durability" warning in one visible place.
 */
const ledgerQueueProvider = {
  provide: LEDGER_QUEUE,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const redisUrl = configService.get<string>('REDIS_URL');
    return redisUrl
      ? new BullMqLedgerQueue(configService)
      : new InProcessLedgerQueue();
  },
};

@Module({
  imports: [
    ConfigModule,
    AdminModule,
    IpfsModule,
    TypeOrmModule.forFeature([Call, AuditLog]),
  ],
  controllers: [OracleController],
  providers: [
    OracleService,
    QuorumConsensusService,
    // BE-017: the transport is a seam, not a dependency. This default keeps
    // every node in one process (dev and tests). A deployment with independent
    // nodes overrides QUORUM_TRANSPORT with a RedisPubSubTransport built on its
    // own client, e.g.:
    //   { provide: QUORUM_TRANSPORT, useValue: new RedisPubSubTransport(client.duplicate()) }
    { provide: QUORUM_TRANSPORT, useClass: InMemoryQuorumTransport },
    // BE-018: the price-staleness guard the resolution path consults before
    // it will settle a call.
    PriceStalenessService,
    // BE-020: ledger-aware expiry scheduling.
    ledgerQueueProvider,
    LedgerSchedulerService,
  ],
  exports: [
    OracleService,
    QuorumConsensusService,
    PriceStalenessService,
    LedgerSchedulerService,
  ],
})
export class OracleModule {}
