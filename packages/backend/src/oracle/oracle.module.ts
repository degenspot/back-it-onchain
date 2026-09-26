import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OracleService } from './oracle.service';
import { OracleController } from './oracle.controller';
import { AdminModule } from '../admin/admin.module';
import { IpfsModule } from '../ipfs/ipfs.module';
import { Call } from '../calls/call.entity';
import { AuditLog } from './audit-log.entity';
import {
  InMemoryQuorumTransport,
  QUORUM_TRANSPORT,
  QuorumConsensusService,
} from './quorum-consensus.service';

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
  ],
  exports: [OracleService, QuorumConsensusService],
})
export class OracleModule {}
