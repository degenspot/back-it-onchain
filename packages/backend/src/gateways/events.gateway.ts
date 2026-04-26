import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

import {
  SubscribeMarketDto,
  UnsubscribeMarketDto,
} from './dto/subscribe-market.dto';
import {
  StakeCreatedEvent,
  PriceUpdatedEvent,
  UserNotificationEvent,
  OutcomeProposedEvent,
  DisputeRaisedEvent,
  DisputeResolvedEvent,
  AuthenticatedSocket,
} from './events.types';

/**
 * Room naming conventions
 *  - Market room : `market:{marketId}`
 *  - User room   : `user:{userId}`
 */
const MARKET_ROOM = (id: string) => `market:${id}`;
const USER_ROOM = (id: string) => `user:${id}`;

@WebSocketGateway({
  namespace: '/events',
  cors: {
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  // ── Lifecycle hooks ────────────────────────────────────────────────────────

  afterInit() {
    this.logger.log('WebSocket gateway initialised on namespace /events');
  }

  /**
   * On every new connection attempt we immediately try to authenticate the
   * client via the bearer token supplied in the handshake.  Authenticated
   * clients are automatically joined to their private user room; anonymous
   * clients can still subscribe to public market rooms.
   */
  async handleConnection(client: AuthenticatedSocket) {
    try {
      const userId = this.extractUserIdFromHandshake(client);
      if (userId) {
        client.data.userId = userId;
        await client.join(USER_ROOM(userId));
        this.logger.debug(
          `Client ${client.id} authenticated as user ${userId}`,
        );
      } else {
        client.data.userId = null;
        this.logger.debug(`Client ${client.id} connected anonymously`);
      }
    } catch {
      // Non-fatal — client is treated as anonymous
      client.data.userId = null;
    }

    this.logger.log(
      `Client connected: ${client.id}`,
    );
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ── Public market subscriptions ────────────────────────────────────────────

  /**
   * Subscribe to live events (stakes, price changes) for a specific market.
   *
   * Payload: { marketId: string }
   * Emits back: "subscribed" | "error"
   */
  @SubscribeMessage('subscribeMarket')
  async handleSubscribeMarket(
    @MessageBody() dto: SubscribeMarketDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const room = MARKET_ROOM(dto.marketId);
    await client.join(room);
    this.logger.debug(`Client ${client.id} joined room ${room}`);
    return { event: 'subscribed', data: { marketId: dto.marketId } };
  }

  /**
   * Unsubscribe from a market room.
   *
   * Payload: { marketId: string }
   * Emits back: "unsubscribed"
   */
  @SubscribeMessage('unsubscribeMarket')
  async handleUnsubscribeMarket(
    @MessageBody() dto: UnsubscribeMarketDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const room = MARKET_ROOM(dto.marketId);
    await client.leave(room);
    this.logger.debug(`Client ${client.id} left room ${room}`);
    return { event: 'unsubscribed', data: { marketId: dto.marketId } };
  }

  // ── Private user notifications ─────────────────────────────────────────────

  /**
   * Authenticated clients re-confirm their identity and join/refresh their
   * private user room.  Useful when the JWT is set after the initial
   * connection (e.g., login in a SPA without reconnecting).
   *
   * Payload: { token: string }
   * Emits back: "authenticated" | WsException
   */
  @SubscribeMessage('authenticate')
  async handleAuthenticate(
    @MessageBody() payload: { token: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const decoded = await this.jwtService.verifyAsync<{ sub: string }>(
        payload.token,
      );
      const userId = decoded.sub;

      // Leave any stale user rooms first
      if (client.data.userId && client.data.userId !== userId) {
        await client.leave(USER_ROOM(client.data.userId));
      }

      client.data.userId = userId;
      await client.join(USER_ROOM(userId));

      this.logger.debug(
        `Client ${client.id} re-authenticated as user ${userId}`,
      );
      return { event: 'authenticated', data: { userId } };
    } catch {
      throw new WsException('Invalid or expired token');
    }
  }

  // ── EventEmitter2 listeners → broadcast to rooms ───────────────────────────

  /**
   * Fired when a new stake is placed on a market (Issue 9 hook: "stake.created").
   * Broadcasts to all clients in the market room.
   */
  @OnEvent('stake.created')
  handleStakeCreated(event: StakeCreatedEvent) {
    this.logger.debug(
      `[stake.created] marketId=${event.marketId} staker=${event.staker}`,
    );
    this.server.to(MARKET_ROOM(event.marketId)).emit('stakeCreated', event);
  }

  /**
   * Fired when an oracle or price feed updates a market's price.
   * Broadcasts to all clients in the market room.
   */
  @OnEvent('price.updated')
  handlePriceUpdated(event: PriceUpdatedEvent) {
    this.logger.debug(
      `[price.updated] marketId=${event.marketId} price=${event.price}`,
    );
    this.server.to(MARKET_ROOM(event.marketId)).emit('priceUpdated', event);
  }

  /**
   * Fired when a new outcome is proposed for a market.
   * Broadcasts to all clients in the market room.
   */
  @OnEvent('outcome.proposed')
  handleOutcomeProposed(event: OutcomeProposedEvent) {
    this.logger.debug(
      `[outcome.proposed] marketId=${event.marketId} callId=${event.callId}`,
    );
    this.server.to(MARKET_ROOM(event.marketId)).emit('outcomeProposed', event);
  }

  /**
   * Fired when an outcome is disputed (from the Stellar contract layer).
   * Broadcasts to the market room AND the staker's private room.
   */
  @OnEvent('dispute.raised')
  handleDisputeRaised(event: DisputeRaisedEvent) {
    this.logger.debug(
      `[dispute.raised] callId=${event.callId} staker=${event.staker}`,
    );
    this.server.to(MARKET_ROOM(event.marketId)).emit('disputeRaised', event);

    // Also push to the staker's private room
    if (event.staker) {
      this.server.to(USER_ROOM(event.staker)).emit('notification', {
        type: 'dispute.raised',
        payload: event,
      });
    }
  }

  /**
   * Fired when admin/DAO resolves a dispute.
   * Broadcasts to the market room; additionally notifies the original staker.
   */
  @OnEvent('dispute.resolved')
  handleDisputeResolved(event: DisputeResolvedEvent) {
    this.logger.debug(
      `[dispute.resolved] callId=${event.callId} resolution=${event.resolution}`,
    );
    this.server.to(MARKET_ROOM(event.marketId)).emit('disputeResolved', event);

    if (event.staker) {
      this.server.to(USER_ROOM(event.staker)).emit('notification', {
        type: 'dispute.resolved',
        payload: event,
      });
    }
  }

  /**
   * Generic user-targeted push notification (Issue 9 hook: "user.notification").
   * Routes exclusively to the recipient's private room.
   */
  @OnEvent('user.notification')
  handleUserNotification(event: UserNotificationEvent) {
    this.logger.debug(
      `[user.notification] userId=${event.userId} type=${event.type}`,
    );
    this.server.to(USER_ROOM(event.userId)).emit('notification', {
      type: event.type,
      payload: event.payload,
      timestamp: event.timestamp ?? Date.now(),
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Extract and verify a JWT from the Socket.io handshake.
   * Accepts the token from either:
   *   - Authorization header: "Bearer <token>"
   *   - Query param: ?token=<token>
   * Returns the user's `sub` claim, or null if absent/invalid.
   */
  private extractUserIdFromHandshake(
    client: AuthenticatedSocket,
  ): string | null {
    try {
      const authHeader =
        (client.handshake.headers.authorization as string) ?? '';
      const queryToken = client.handshake.query.token as string | undefined;

      const raw = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : queryToken;

      if (!raw) return null;

      const decoded = this.jwtService.verify<{ sub: string }>(raw);
      return decoded.sub ?? null;
    } catch {
      return null;
    }
  }

  // ── Imperative broadcast helpers (usable from other services) ─────────────

  /** Broadcast an arbitrary event to an entire market room. */
  broadcastToMarket<T>(marketId: string, event: string, data: T): void {
    this.server.to(MARKET_ROOM(marketId)).emit(event, data);
  }

  /** Send an event to a specific user's private room. */
  sendToUser<T>(userId: string, event: string, data: T): void {
    this.server.to(USER_ROOM(userId)).emit(event, data);
  }

  emitCallCreated(callId: number, marketId: string): void {
    this.server.to(MARKET_ROOM(String(marketId))).emit('call_created', { callId, marketId });
  }

  emitStakeAdded(marketId: string, stakeData: Record<string, unknown>): void {
    this.server.to(MARKET_ROOM(marketId)).emit('stake_added', { marketId, ...stakeData });
  }

  emitOutcomeResolved(marketId: string, callId: string, outcome: unknown): void {
    this.server.to(MARKET_ROOM(marketId)).emit('outcome_resolved', { marketId, callId, outcome });
  }
}
