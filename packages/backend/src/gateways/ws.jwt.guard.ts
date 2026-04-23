import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

/**
 * Guard for WebSocket message handlers that require an authenticated user.
 *
 * Checks `socket.data.userId` which is populated during `handleConnection`.
 * Falls back to verifying a `token` field in the message payload for clients
 * that authenticate mid-session via the `authenticate` message.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient<Socket>();

    // Fast path — already authenticated at connection time
    if (client.data.userId) {
      return true;
    }

    // Slow path — check for inline token in message payload
    const data = context.switchToWs().getData<{ token?: string }>();
    if (!data?.token) {
      throw new WsException('Authentication required');
    }

    try {
      const decoded = await this.jwtService.verifyAsync<{ sub: string }>(
        data.token,
      );
      client.data.userId = decoded.sub;
      return true;
    } catch {
      throw new WsException('Invalid or expired token');
    }
  }
}
