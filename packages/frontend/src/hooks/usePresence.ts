'use client';

/**
 * Live presence / viewer count (FE-24).
 *
 * Shows how many people are currently viewing a market. It subscribes to the
 * Socket.io room `presence:<id>` (subscriber only) and falls back to a slow
 * poll when the socket is unavailable so the count degrades gracefully.
 *
 * The transport is injectable: tests drive a fake socket instead of standing up
 * a server, and the feed can run entirely offline against polling.
 */

import * as React from 'react';

export interface PresenceUpdate {
  /** Number of live viewers on the market. */
  viewers: number;
}

/** Minimal surface this hook needs from a socket. */
export interface PresenceSocket {
  on: (event: string, handler: (payload: PresenceUpdate) => void) => void;
  off: (event: string, handler?: (payload: PresenceUpdate) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  disconnect: () => void;
  connected?: boolean;
}

export type PresenceSocketFactory = (room: string) => PresenceSocket;

/** Poll interval while the socket is down. */
export const POLL_INTERVAL_MS = 30_000;

export interface UsePresenceOptions {
  socketFactory?: PresenceSocketFactory;
  fetchViewers?: (marketId: string) => Promise<number>;
  pollIntervalMs?: number;
  /** Disable both transports — used for static rendering and tests. */
  enabled?: boolean;
}

export interface UsePresenceResult {
  viewers: number;
  connected: boolean;
  online: boolean;
}

/** The room a market broadcasts live presence on. */
export function presenceRoomFor(marketId: string): string {
  return `presence:${marketId}`;
}

export function usePresence(
  marketId: string,
  options: UsePresenceOptions = {},
): UsePresenceResult {
  const {
    socketFactory,
    fetchViewers,
    pollIntervalMs = POLL_INTERVAL_MS,
    enabled = true,
  } = options;

  const [viewers, setViewers] = React.useState(0);
  const [connected, setConnected] = React.useState(false);

  // Socket subscription — the primary, low-latency transport.
  React.useEffect(() => {
    if (!enabled || !socketFactory || !marketId) return;

    const socket = socketFactory(presenceRoomFor(marketId));
    const handler = (payload: PresenceUpdate) => {
      // Only accept sane values broadcast from the presence server.
      if (payload.viewers >= 0) setViewers(payload.viewers);
    };

    socket.on('presence', handler);
    socket.emit('join', presenceRoomFor(marketId));
    setConnected(true);

    return () => {
      socket.off('presence', handler);
      socket.disconnect();
      setConnected(false);
    };
  }, [enabled, marketId, socketFactory]);

  // Polling fallback — gradual, covers a blocked/silently-dead socket.
  React.useEffect(() => {
    if (!enabled || !fetchViewers || !marketId) return;

    let cancelled = false;

    const load = async () => {
      try {
        const count = await fetchViewers(marketId);
        if (!cancelled && count >= 0) setViewers(count);
      } catch {
        // A failed poll is not fatal; the next tick retries.
      }
    };

    void load();

    const interval = setInterval(load, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, fetchViewers, marketId, pollIntervalMs]);

  return {
    viewers,
    connected,
    online: viewers > 0,
  };
}
