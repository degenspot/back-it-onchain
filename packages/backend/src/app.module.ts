import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
import { validationSchema } from './config/env.validation';

import { User } from './users/user.entity';
import { Call } from './calls/call.entity';
import { StakeActivity } from './calls/stake-activity.entity';
import { AuthModule } from './auth/auth.module';
import { CallsModule } from './calls/calls.module';
import { OracleModule } from './oracle/oracle.module';
import { IndexerModule } from './indexer/indexer.module';
import { UsersModule } from './users/users.module';
import { UserFollows } from './users/user-follows.entity';
import { UserSettings } from './users/user-settings.entity';
import { FeedModule } from './feed/feed.module';
import { NotificationsModule } from './notifications/notifications.module';
import { Notification } from './notifications/notification.entity';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { PlatformSettings } from './indexer/platform-settings.entity';
import { BadgesModule } from './badges/badges.module';
import { UserBadge } from './badges/badge.entity';
import { AnalyticsModule } from './analytics/analytics.module';
import { UploadsModule } from './uploads/uploads.module';
import { GatewaysModule } from './gateways/gateways.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (redisUrl) {
          const KeyvRedis = (await import('@keyv/redis')).default;
          return { stores: [new KeyvRedis(redisUrl)] };
        }
        // Fall back to in-memory store when REDIS_URL is not configured
        return {};
      },
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_DATABASE', 'back_it_onchain'),

        entities: [
          User,
          Call,
          StakeActivity,
          UserFollows,
          UserSettings,
          Notification,
          PlatformSettings,
          UserBadge,
        ],

        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User, Call]),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'short',
        ttl: 60000,
        limit: 5,
      },
    ]),
    AuthModule,
    CallsModule,
    OracleModule,
    IndexerModule,
    UsersModule,
    FeedModule,
    NotificationsModule,
    LeaderboardModule,
    BadgesModule,
    AnalyticsModule,
    UploadsModule,
    GatewaysModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
