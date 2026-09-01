'use client';

import { cn } from '@/lib/utils';
import { usePresence, type PresenceSocketFactory } from '../hooks/usePresence';

export interface LivePresenceProps {
  marketId: string;
  /** Injectable transports (FE-24 favours the subscriber + polling fallback). */
  socketFactory?: PresenceSocketFactory;
  fetchViewers?: (marketId: string) => Promise<number>;
  /** Render a compact pill instead of the full text. */
  compact?: boolean;
  className?: string;
}

/**
 * Displays how many people are viewing a market right now: `● 12 live`.
 *
 * Falls back gracefully when the socket is unavailable — it either shows a
 * polling-derived count, or nothing at all instead of a stale/incorrect number.
 */
export function LivePresence({
  marketId,
  socketFactory,
  fetchViewers,
  compact = false,
  className,
}: LivePresenceProps) {
  // When neither transport is provided, the component shows nothing rather
  // than a misleading "0 live".
  const enabled = Boolean(socketFactory || fetchViewers);
  const { viewers, connected } = usePresence(marketId, {
    enabled,
    socketFactory,
    fetchViewers,
  });

  if (!enabled || viewers <= 0) return null;

  return (
    <span
      data-testid="live-presence"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500',
        className,
      )}
    >
      <span className="relative flex h-2 w-2" data-testid="presence-dot">
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75',
            !connected && 'animate-none opacity-30',
          )}
        />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {compact ? (
        <span>
          {viewers} <span className="sr-only">live</span>
        </span>
      ) : (
        <span>
          {viewers} <span className="font-normal">live</span>
        </span>
      )}
    </span>
  );
}
