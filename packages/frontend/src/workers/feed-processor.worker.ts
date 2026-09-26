import type { Call } from '../../lib/types';

export type FeedWorkerRequest =
  | { type: 'merge'; items: Call[]; incoming?: Call[] }
  | { type: 'filter'; items: Call[]; query: string }
  | { type: 'reset' };

export interface FeedWorkerResult {
  type: 'result';
  items: Call[];
  seenIds: number;
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<FeedWorkerRequest>) => void) | null;
  postMessage: (message: FeedWorkerResult) => void;
};

const scope = self as unknown as WorkerScope;
const seen = new Set<string>();
let items: Call[] = [];

function callId(call: Call): string {
  return String(call.callOnchainId || call.id);
}

function merge(incoming: Call[]): Call[] {
  const byId = new Map(items.map((item) => [callId(item), item]));
  for (const item of incoming) {
    const id = callId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    byId.set(id, item);
  }
  items = Array.from(byId.values()).sort((a, b) => {
    const aTime = Date.parse(String(a.createdAt || '')) || 0;
    const bTime = Date.parse(String(b.createdAt || '')) || 0;
    return bTime - aTime;
  });
  return items;
}

function filter(query: string): Call[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => [item.title, item.asset, item.target, item.creator?.displayName, item.creator?.handle]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized)));
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'reset') {
    items = [];
    seen.clear();
    scope.postMessage({ type: 'result', items, seenIds: 0 });
    return;
  }
  if (message.type === 'filter') {
    scope.postMessage({ type: 'result', items: filter(message.query), seenIds: seen.size });
    return;
  }
  const result = merge([...message.items, ...(message.incoming || [])]);
  scope.postMessage({ type: 'result', items: result, seenIds: seen.size });
};
