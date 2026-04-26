'use client';

import { TrendingCall } from '@/app';
import { api } from '@/lib/apiClient';
import { useEffect, useState } from 'react';

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonItem() {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-white/5 p-3 animate-pulse">
      <div className="h-3.5 w-3/4 rounded bg-white/10" />
      <div className="h-3 w-1/2 rounded bg-white/10" />
    </div>
  );
}

// ── Trending item ─────────────────────────────────────────────────────────────

function TrendingItem({ call }: { call: TrendingCall }) {
  const formattedVolume = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(call.volume24h);

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-white/5 p-3 hover:bg-white/10 transition-colors cursor-pointer">
      <p className="text-sm font-medium text-white leading-snug line-clamp-2">
        {call.title}
      </p>
      <div className="flex items-center gap-2 text-xs text-white/50">
        <span>Vol {formattedVolume}</span>
        <span>·</span>
        <span>Score {call.trendingScore.toFixed(1)}</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TrendingSidebar() {
  const [calls, setCalls] = useState<TrendingCall[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.get<TrendingCall[]>('/feed/trending?limit=3');
        if (!cancelled) setCalls(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className="w-72 shrink-0">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/40">
        Trending Markets
      </h3>

      <div className="flex flex-col gap-2">
        {isLoading ? (
          <>
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
          </>
        ) : error ? (
          <p className="text-xs text-red-400">{error}</p>
        ) : calls.length === 0 ? (
          <p className="text-xs text-white/40">No trending markets right now.</p>
        ) : (
          calls.map((call) => <TrendingItem key={call.id} call={call} />)
        )}
      </div>
    </aside>
  );
}