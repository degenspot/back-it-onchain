import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { SocketIoRedisAdapterProvider } from '../config/redis.config';
import { EventsGateway } from './events.gateway';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@Module({
  imports: [AuthModule, ConfigModule],
  providers: [EventsGateway, WsJwtGuard, SocketIoRedisAdapterProvider],
  exports: [EventsGateway],
})
export class GatewaysModule {}
