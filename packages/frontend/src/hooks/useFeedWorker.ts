'use client';

import * as React from 'react';
import type { Call } from '../../lib/types';
import type { FeedWorkerRequest, FeedWorkerResult } from '../workers/feed-processor.worker';

export function useFeedWorker(calls: Call[], enabled = true): Call[] {
  const [processed, setProcessed] = React.useState<Call[]>(calls);

  React.useEffect(() => {
    if (!enabled || typeof Worker === 'undefined') {
      setProcessed(calls);
      return;
    }

    const worker = new Worker(new URL('../workers/feed-processor.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FeedWorkerResult>) => {
      if (event.data?.type === 'result') setProcessed(event.data.items);
    };
    const request: FeedWorkerRequest = { type: 'merge', items: calls };
    worker.postMessage(request);

    return () => {
      worker.terminate();
    };
  }, [calls, enabled]);

  return processed;
}
