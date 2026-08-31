'use client';

/**
 * PWA helpers (FE-31): online/offline state and draft-queue syncing.
 */

export type NetworkStatus = 'online' | 'offline';

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export interface QueuedDraft {
  id: string;
  payload: unknown;
  queuedAt: number;
}

const QUEUE_KEY = 'offline-draft-queue';

const SW_PATH = '/sw.js';

export function isServiceWorkerSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in window.navigator;
}

/**
 * Registers the app shell / feed-cache service worker (FE-31).
 *
 * Service workers are only available on https (localhost counts), so the
 * guard keeps dev-over-LAN and http previews from throwing.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null;
  try {
    return await window.navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[pwa] service worker registration failed', error);
    }
    return null;
  }
}

export function readDraftQueue(): QueuedDraft[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedDraft[]) : [];
  } catch {
    return [];
  }
}

export function writeDraftQueue(queue: QueuedDraft[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function queueDraft(payload: unknown): QueuedDraft {
  const queue = readDraftQueue();
  const entry: QueuedDraft = {
    id: `draft-${Date.now()}`,
    payload,
    queuedAt: Date.now(),
  };
  writeDraftQueue([...queue, entry]);
  return entry;
}

export function drainDraftQueue(): QueuedDraft[] {
  const queue = readDraftQueue();
  writeDraftQueue([]);
  return queue;
}
