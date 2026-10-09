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
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { SocketIoRedisAdapterProvider } from '../config/redis.config';

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
  DisputeEscalatedEvent,
  DisputeDecisionEvent,
  AuthenticatedSocket,
} from './events.types';

/**
 * Room naming conventions
 *  - Market room : `market:{marketId}`
 *  - User room   : `user:{userId}`
 */
const MARKET_ROOM = (id: string) => `market:${id}`;
const USER_ROOM = (id: string) => `user:${id}`;

/**
 * How long a client may stay connected after a drop before its rooms are
 * forgotten. Long enough to ride out a network blip or a rolling deploy, short
 * enough that a genuinely departed client is not counted against the 10k
 * connection budget indefinitely.
 */
const RECOVERY_WINDOW_MS = 2 * 60 * 1000;

/** Per-IP connection budget, and how long it refills. */
const DEFAULT_IP_CONNECT_LIMIT = 20;
const DEFAULT_IP_WINDOW_MS = 60_000;

/** Hard cap on tracked IPs, so a spoofed-source flood cannot exhaust memory. */
const MAX_TRACKED_IPS = 20_000;

@WebSocketGateway({
  namespace: '/events',
  cors: {
    // Resolved from WS_CORS_ORIGIN at boot in `afterInit`; the literal here is
    // only a placeholder for the decorator, which is evaluated at import time.
    origin: false,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  // Restores rooms and missed packets after a reconnect, so a client that drops
  // does not have to re-subscribe or replay from scratch.
  connectionStateRecovery: {
    maxDisconnectionDuration: RECOVERY_WINDOW_MS,
    skipMiddlewares: true,
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  /**
   * Connection attempts per IP, as a sliding window.
   *
   * Bounded on purpose: an unbounded map keyed by IP is itself a denial of
   * service, since an attacker controls the source address.
   */
  private readonly ipWindows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisAdapter: SocketIoRedisAdapterProvider,
  ) {}

  // ── Lifecycle hooks ────────────────────────────────────────────────────────

  afterInit() {
    // A wildcard origin combined with credentials is both invalid per the CORS
    // spec and actively unsafe: it lets any site open an authenticated socket
    // as the user. So `*` is stripped from the allowlist rather than honoured,
    // and the default allowlist is empty — deny, not open.
    const allowed = this.allowedOrigins();
    this.logger.log(
      `WebSocket gateway initialised on /events (CORS allowlist: ` +
        `${allowed.join(', ') || 'empty — browser origins denied'})`,
    );

    // engine.io's own CORS handling is off (`origin: false` in the decorator)
    // because the allowlist is only known once ConfigService is available, and
    // the decorator is evaluated at import time. Header *writing* is done here
    // for the browser's benefit; the actual decision is `isOriginAllowed` in
    // handleConnection, so a disallowed origin is rejected rather than merely
    // denied the header.
    this.server.engine?.on?.(
      'headers',
      (_event: unknown, headers: Record<string, unknown>) => {
        const origin = headers.origin;
        if (typeof origin === 'string' && allowed.includes(origin)) {
          headers['access-control-allow-origin'] = origin;
          headers['access-control-allow-credentials'] = 'true';
          // Read as a string: `headers` is untyped, so interpolating it directly
          // would emit "vary: [object Object]".
          const existingVary = headers.vary;
          headers.vary =
            typeof existingVary === 'string' && existingVary
              ? `${existingVary}, Origin`
              : 'Origin';
        }
        // Deliberately no fallback: writing some other origin here would be
        // meaningless, and writing `*` would defeat the point.
      },
    );

    const adapter = this.redisAdapter.createAdapter(this.server);
    if (adapter) {
      this.logger.log(
        'Socket.io running in cluster mode — broadcasts fan out via Redis',
      );
    } else {
      this.logger.warn(
        'Socket.io running single-instance. Broadcasts will not reach clients ' +
          'connected to other replicas. Set REDIS_URL to enable clustering.',
      );
    }
  }

  /**
   * Whether a handshake origin may open a socket.
   *
   * A request with no `Origin` is not a browser and is not governed by CORS —
   * native and server-side clients never send one — so it is allowed through and
   * remains subject to the JWT and rate-limit checks. An `Origin` that is not on
   * the allowlist is refused.
   */
  private isOriginAllowed(handshakeOrigin?: string): boolean {
    if (!handshakeOrigin) return true;
    return this.allowedOrigins().includes(handshakeOrigin);
  }

  /**
   * Origins permitted to open a socket, from WS_CORS_ORIGIN.
   *
   * A wildcard is dropped rather than passed through: this gateway sends
   * credentials, and `Access-Control-Allow-Origin: *` alongside credentials is
   * rejected by browsers and is the exact misconfiguration that lets a random
   * site ride a logged-in user's session.
   */
  private allowedOrigins(): string[] {
    const raw =
      this.configService.get<string>('WS_CORS_ORIGIN') ??
      this.configService.get<string>('CORS_ORIGIN') ??
      '';
    return raw
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o && o !== '*');
  }

  private get ipConnectLimit(): number {
    return this.configService.get<number>(
      'WS_IP_CONNECT_LIMIT',
      DEFAULT_IP_CONNECT_LIMIT,
    );
  }

  private get ipWindowMs(): number {
    return this.configService.get<number>(
      'WS_IP_WINDOW_MS',
      DEFAULT_IP_WINDOW_MS,
    );
  }

  /**
   * Consume one connection token for this IP.
   *
   * Returns false when the IP is over budget. The window is a plain
   * fixed-window counter: cheap, and good enough — a token-bucket would be
   * smoother but the goal is only to stop a single source opening thousands of
   * sockets, not to meter legitimate traffic precisely.
   */
  private consumeConnectionToken(ip: string): boolean {
    const now = Date.now();
    const window = this.ipWindows.get(ip);

    if (!window || window.resetAt <= now) {
      if (this.ipWindows.size >= MAX_TRACKED_IPS) this.pruneIpWindows(now);
      this.ipWindows.set(ip, { count: 1, resetAt: now + this.ipWindowMs });
      return true;
    }

    if (window.count >= this.ipConnectLimit) return false;

    window.count += 1;
    return true;
  }

  /** Drop expired windows, and the oldest ones if still at the cap. */
  private pruneIpWindows(now: number): void {
    for (const [ip, window] of this.ipWindows) {
      if (window.resetAt <= now) this.ipWindows.delete(ip);
    }
    // Still full after pruning: shed the oldest insertions. Map preserves
    // insertion order, so the first keys are the oldest. Read through
    // `IteratorResult.done` rather than `.value` so the key stays typed as a
    // string instead of collapsing to `any`.
    while (this.ipWindows.size >= MAX_TRACKED_IPS) {
      const oldest = this.ipWindows.keys().next();
      if (oldest.done) break;
      this.ipWindows.delete(oldest.value);
    }
  }

  /**
   * On every new connection attempt we immediately try to authenticate the
   * client via the bearer token supplied in the handshake.  Authenticated
   * clients are automatically joined to their private user room; anonymous
   * clients can still subscribe to public market rooms.
   */
  async handleConnection(client: AuthenticatedSocket) {
    const ip = this.resolveIp(client);

    // Origin first: a request from a site that is not on the allowlist should
    // not be able to spend a rate-limit token or a connection slot.
    const origin = client.handshake.headers.origin;
    if (typeof origin === 'string' && !this.isOriginAllowed(origin)) {
      this.logger.warn(
        `Rejecting connection ${client.id}: origin ${origin} is not allowed`,
      );
      client.emit('error', {
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'Origin not allowed',
      });
      client.disconnect(true);
      return;
    }

    // Hard connection ceiling. The issue targets 10k concurrent sockets, and
    // this is where that number becomes a real budget rather than an aspiration:
    // past it, new connections are refused instead of letting the process grow
    // until it is OOM-killed, taking every existing client's feed with it.
    const maxConnections = this.configService.get<number>(
      'WS_MAX_CONNECTIONS',
      10_000,
    );
    const current = this.server.engine?.clientsCount ?? 0;
    if (current >= maxConnections) {
      this.logger.error(
        `Refusing ${client.id}: at capacity (${current}/${maxConnections})`,
      );
      client.emit('error', {
        code: 'AT_CAPACITY',
        message: 'Server is at connection capacity, please retry shortly',
      });
      client.disconnect(true);
      return;
    }

    if (!this.consumeConnectionToken(ip)) {
      this.logger.warn(
        `Rejecting connection from ${ip}: over the ${this.ipConnectLimit}/window limit`,
      );
      client.emit('error', {
        code: 'RATE_LIMITED',
        message: 'Too many connections from this address',
      });
      client.disconnect(true);
      return;
    }

    try {
      const userId = this.extractUserIdFromHandshake(client);
      if (userId) {
        client.data.userId = userId;
        client.data.authenticatedAt = Date.now();
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

    // Debug, not log: at 10k connections this line alone would be the bulk of
    // the log volume, and it costs I/O on the hot path.
    this.logger.debug(
      `Client connected: ${client.id} (${this.server.engine?.clientsCount ?? '?'} online)`,
    );
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.debug(
      `Client disconnected: ${client.id} (${this.server.engine?.clientsCount ?? '?'} online)`,
    );
  }

  /**
   * Best-effort client address, for the connection rate limit.
   *
   * `x-forwarded-for` is client-controlled unless a trusted proxy sets it, so
   * this is only meaningful behind one. It is still the right default here: the
   * deployment terminates TLS at a proxy, and without the header every client
   * would share the proxy's address and trip the limit for everyone at once.
   * Set WS_TRUST_PROXY=false to ignore the header when there is no proxy.
   */
  private resolveIp(client: AuthenticatedSocket): string {
    if (this.configService.get<boolean>('WS_TRUST_PROXY', true)) {
      const forwarded = client.handshake.headers['x-forwarded-for'];
      const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      if (typeof value === 'string' && value.length > 0) {
        // Left-most entry is the original client.
        return value.split(',')[0].trim();
      }
    }
    return client.handshake.address ?? 'unknown';
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

  // ── Dispute lifecycle broadcasts (BE-019) ───────────────────────────────

  /**
   * A dispute crossed the stake threshold and is now with governance.
   *
   * Broadcast to the market room because the outcome changes the market's
   * result, and to the staker's private room because their bond is now tied to
   * a vote they may want to follow.
   */
  @OnEvent('dispute.escalated')
  handleDisputeEscalated(event: DisputeEscalatedEvent) {
    this.logger.log(
      `[dispute.escalated] dispute=${event.disputeId} call=${event.callId} ` +
        `bond=${event.totalBond} quorum=${event.quorum}`,
    );

    this.server.to(MARKET_ROOM(event.callId)).emit('dispute_escalated', {
      ...event,
      timestamp: Date.now(),
    });
    this.server.to(MARKET_ROOM(event.marketId ?? event.callId)).emit(
      'dispute_escalated',
      { ...event, timestamp: Date.now() },
    );
  }

  /** The resolution was overturned: the market's outcome has changed. */
  @OnEvent('dispute.overturned')
  handleDisputeOverturned(event: DisputeDecisionEvent) {
    this.logger.warn(
      `[dispute.overturned] dispute=${event.disputeId} call=${event.callId}`,
    );
    this.server.to(MARKET_ROOM(event.callId)).emit('dispute_overturned', {
      ...event,
      timestamp: Date.now(),
    });
  }

  /** The dispute failed: the original resolution stands, bonds are returned. */
  @OnEvent('dispute.confirmed')
  handleDisputeConfirmed(event: DisputeDecisionEvent) {
    this.logger.log(
      `[dispute.confirmed] dispute=${event.disputeId} call=${event.callId}`,
    );
    this.server.to(MARKET_ROOM(event.callId)).emit('dispute_confirmed', {
      ...event,
      timestamp: Date.now(),
    });
  }

  /** Counter-evidence was filed against an open dispute. */
  @OnEvent('dispute.counter_evidence')
  handleDisputeCounterEvidence(event: {
    disputeId: string;
    callId: string;
    submitter: string;
    cid: string;
  }) {
    this.server.to(MARKET_ROOM(event.callId)).emit('dispute_counter_evidence', {
      ...event,
      timestamp: Date.now(),
    });
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
   *   - Query param: ?token=<token>
   *   - Authorization header: "Bearer <token>"
   *
   * The issue specifies a query token, and that is the right primary path for a
   * browser: the WebSocket constructor offers no way to set an Authorization
   * header, so a browser client can only pass credentials in the URL. The header
   * stays supported for server-side and native clients.
   *
   * Returns the user's `sub` claim, or null if absent/invalid.
   *
   * An invalid token yields anonymous rather than a refused connection, because
   * market rooms are public and a client with an expired token should still see
   * prices. Identity is only ever established by this returning a value, so an
   * anonymous socket cannot reach a private room.
   */
  private extractUserIdFromHandshake(
    client: AuthenticatedSocket,
  ): string | null {
    const queryToken = client.handshake.query.token as string | undefined;
    const authHeader =
      (client.handshake.headers.authorization as string) ?? '';

    const raw = queryToken ?? (authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined);

    if (!raw) return null;

    try {
      const decoded = this.jwtService.verify<{ sub: string }>(raw);
      return decoded.sub ?? null;
    } catch (err) {
      this.logger.debug(
        `Rejected handshake token for ${client.id}: ${(err as Error).message}`,
      );
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
