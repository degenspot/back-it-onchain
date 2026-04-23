import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway';
import { WsJwtGuard } from './ws.jwt.guard';

@Module({
  imports: [
      }),
    }),
  ],
  providers: [EventsGateway, WsJwtGuard],
  exports: [EventsGateway],
})
export class GatewaysModule { }
