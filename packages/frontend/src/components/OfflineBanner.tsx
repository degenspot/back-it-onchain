'use client';

import { useOfflineQueue } from '@/src/hooks/useOfflineQueue';

export interface OfflineBannerProps {
  onSynced?: (count: number) => void;
}

export function OfflineBanner({ onSynced }: OfflineBannerProps) {
  const { offline, pending } = useOfflineQueue(onSynced);

  if (!offline) return null;

  return (
    <div
      data-testid="offline-banner"
      className="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs font-medium text-destructive"
    >
      <span>
        You are offline{pending > 0 ? ` · ${pending} draft${pending === 1 ? '' : 's'} queued` : ''}
      </span>
      <span className="rounded-full bg-destructive/20 px-2 py-0.5">Reconnect to sync</span>
    </div>
  );
}
