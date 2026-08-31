'use client';

/**
 * Social feed data (FE-06).
 *
 * Three tabs over one cursor-paginated endpoint. Cursor rather than offset
 * paging is what keeps an infinite scroll stable: with offsets, a call
 * created while you are scrolling shifts every later page by one and you see
 * a duplicate.
 */

import * as React from 'react';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { Call } from '../../lib/types';
import { applyFeedPrefs, useFeedPrefs } from './useFeedPrefs';

export type FeedTab = 'for-you' | 'following' | 'trending';

export const FEED_TABS: readonly FeedTab[] = ['for-you', 'following', 'trending'] as const;

export const FEED_TAB_LABELS: Record<FeedTab, string> = {
  'for-you': 'For You',
  following: 'Following',
  trending: 'Trending',
};

export interface FeedPage {
  items: Call[];
  /** Cursor for the next page, absent on the last one. */
  nextCursor?: string | null;
}

export interface UseFeedOptions {
  /** Overridable for tests; defaults to the configured API base. */
  fetchPage?: (tab: FeedTab, cursor?: string) => Promise<FeedPage>;
  enabled?: boolean;
}

async function defaultFetchPage(tab: FeedTab, cursor?: string): Promise<FeedPage> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const params = new URLSearchParams({ tab });

  if (cursor) params.set('cursor', cursor);

  const response = await fetch(`${base}/feed?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Feed request failed (${response.status})`);
  }

  const body = (await response.json()) as FeedPage | Call[];

  // Accept a bare array so a simpler backend still renders — it just has no
  // further pages.
  return Array.isArray(body) ? { items: body, nextCursor: null } : body;
}

export interface UseFeedResult {
  calls: Call[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  /** Pull-to-refresh: discards pages and refetches from the first cursor. */
  refresh: () => Promise<unknown>;
  isRefreshing: boolean;
}

export function useFeed(tab: FeedTab, options: UseFeedOptions = {}): UseFeedResult {
  const { fetchPage = defaultFetchPage, enabled = true } = options;

  const query = useInfiniteQuery<FeedPage, Error, InfiniteData<FeedPage>, [string, FeedTab], string | undefined>({
    queryKey: ['feed', tab],
    queryFn: ({ pageParam }) => fetchPage(tab, pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });

  // Personalization (FE-30): muted authors/tokens, chain filters and ranking
  // weights are applied client-side to whatever the API returned.
  const { prefs } = useFeedPrefs();

  // Flattened once per data change rather than on every render, since the
  // list feeds a memoised virtualiser downstream.
  const flattened = React.useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  );

  const calls = React.useMemo(
    () => applyFeedPrefs(flattened, prefs),
    [flattened, prefs],
  );

  return {
    calls,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error ?? null,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => {
      // Guarded here so callers — including an intersection observer that can
      // fire repeatedly — do not have to remember to.
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refresh: () => query.refetch(),
    isRefreshing: query.isRefetching,
  };
}

/**
 * Which slice of a long list is worth rendering.
 *
 * Pure, so the windowing arithmetic is testable without a layout engine —
 * jsdom reports every height as zero, which would make a DOM-driven test of
 * this vacuous.
 */
export function computeWindow(options: {
  scrollTop: number;
  viewportHeight: number;
  itemHeight: number;
  itemCount: number;
  overscan?: number;
}): { startIndex: number; endIndex: number; paddingTop: number; paddingBottom: number } {
  const { scrollTop, viewportHeight, itemHeight, itemCount, overscan = 3 } = options;

  if (itemHeight <= 0 || itemCount <= 0) {
    return { startIndex: 0, endIndex: itemCount, paddingTop: 0, paddingBottom: 0 };
  }

  // A zero-height viewport means the container has not been measured yet.
  // Rendering the first screenful is better than rendering nothing, which
  // would leave the list blank until a resize happened to fire.
  const effectiveViewport = viewportHeight > 0 ? viewportHeight : itemHeight * 10;

  const first = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visible = Math.ceil(effectiveViewport / itemHeight) + overscan * 2;
  const last = Math.min(itemCount, first + visible);

  return {
    startIndex: first,
    endIndex: last,
    paddingTop: first * itemHeight,
    paddingBottom: Math.max(0, (itemCount - last) * itemHeight),
  };
}
