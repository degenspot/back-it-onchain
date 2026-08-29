'use client';

import * as React from 'react';
import { isOffline, readDraftQueue, drainDraftQueue } from '@/src/lib/pwa';

/**
 * Offline draft queue (FE-31). Tracks connectivity; when the connection returns
 * and drafts were queued, it calls onSync with the number flushed.
 */
export function useOfflineQueue(onSync?: (count: number) => void) {
  const [offline, setOffline] = React.useState<boolean>(() => isOffline());
  const [pending, setPending] = React.useState<number>(() => readDraftQueue().length);

  React.useEffect(() => {
    const handleOnline = () => {
      setOffline(false);
      const drained = drainDraftQueue();
      if (drained.length > 0) {
        setPending(0);
        onSync?.(drained.length);
      }
    };
    const handleOffline = () => {
      setOffline(true);
      setPending(readDraftQueue().length);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onSync]);

  return { offline, pending };
}
