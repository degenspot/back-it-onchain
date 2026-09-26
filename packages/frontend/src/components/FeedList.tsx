'use client';

import React from 'react';
import { type Call } from '../../lib/types';
import { computeWindow } from '../hooks/useFeed';
import { useFeedWorker } from '../hooks/useFeedWorker';

/** Assumed row height for windowing, in px. */
export const DEFAULT_ITEM_HEIGHT = 180;

/** How close to the bottom the sentinel sits before more is requested. */
export const INFINITE_SCROLL_ROOT_MARGIN = '400px';

export interface FeedListProps {
  isLoading?: boolean;
  calls?: Call[];
  /** Rendered instead of the list when the feed failed to load. */
  error?: Error | null;
  onRetry?: () => void;
  /** Called when the sentinel scrolls into view. */
  onLoadMore?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  /** Pull-to-refresh handler; the control is hidden when absent. */
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /**
   * Render only the rows near the viewport.
   *
   * Off by default so the component stays a plain list wherever the extra
   * machinery is not needed, and so existing callers are unaffected.
   */
  virtualized?: boolean;
  itemHeight?: number;
  /** Row renderer; defaults to the call title. */
  renderCall?: (call: Call) => React.ReactNode;
  enableWorker?: boolean;
}

/**
 * Feed list with infinite scroll, optional windowing and pull-to-refresh
 * (FE-06).
 *
 * The states are deliberately distinct. "Loading", "empty" and "failed" mean
 * different things to a reader, and collapsing a failure into "No calls
 * found" tells someone their feed is empty when in fact it never loaded.
 */
export function FeedList({
  isLoading,
  calls = [],
  error,
  onRetry,
  onLoadMore,
  hasNextPage,
  isFetchingNextPage,
  onRefresh,
  isRefreshing,
  virtualized,
  itemHeight = DEFAULT_ITEM_HEIGHT,
  renderCall,
  enableWorker = false,
}: FeedListProps) {
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const workerCalls = useFeedWorker(calls, enableWorker);
  const displayCalls = enableWorker ? workerCalls : calls;

  // Infinite scroll. An observer is used rather than a scroll handler so the
  // browser decides when the sentinel is near, and nothing runs per frame.
  React.useEffect(() => {
    const node = sentinelRef.current;

    if (!node || !onLoadMore || !hasNextPage) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: INFINITE_SCROLL_ROOT_MARGIN },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [hasNextPage, onLoadMore]);

  React.useEffect(() => {
    if (!virtualized) return;

    const node = scrollRef.current;

    if (node) setViewportHeight(node.clientHeight);
  }, [virtualized]);

  if (isLoading) {
    return <div data-testid="loading-state">Loading...</div>;
  }

  if (error) {
    return (
      <div data-testid="error-state" role="alert" className="flex flex-col gap-2">
        <p>{error.message || 'Could not load the feed'}</p>
        {onRetry ? (
          <button type="button" data-testid="feed-retry" onClick={onRetry} className="underline">
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  if (!displayCalls || displayCalls.length === 0) {
    return <div data-testid="empty-state">No calls found</div>;
  }

  const window = virtualized
    ? computeWindow({ scrollTop, viewportHeight, itemHeight, itemCount: displayCalls.length })
    : { startIndex: 0, endIndex: displayCalls.length, paddingTop: 0, paddingBottom: 0 };

  const visible = displayCalls.slice(window.startIndex, window.endIndex);

  return (
    <div className="flex flex-col gap-2">
      {onRefresh ? (
        <button
          type="button"
          data-testid="feed-refresh"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="self-start text-sm underline disabled:opacity-50"
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      ) : null}

      <div
        ref={scrollRef}
        data-testid="feed-list"
        onScroll={virtualized ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
        className={virtualized ? 'max-h-[80vh] overflow-y-auto' : undefined}
      >
        {window.paddingTop > 0 ? (
          <div data-testid="feed-padding-top" style={{ height: window.paddingTop }} />
        ) : null}

        {visible.map((call, index) => (
          <div
            key={call.id ?? window.startIndex + index}
            data-testid="call-card"
            style={virtualized ? { height: itemHeight } : undefined}
          >
            {renderCall ? renderCall(call) : call.title}
          </div>
        ))}

        {window.paddingBottom > 0 ? (
          <div data-testid="feed-padding-bottom" style={{ height: window.paddingBottom }} />
        ) : null}

        {hasNextPage ? <div ref={sentinelRef} data-testid="feed-sentinel" /> : null}
      </div>

      {isFetchingNextPage ? (
        <div data-testid="feed-loading-more">Loading more…</div>
      ) : null}

      {!hasNextPage && displayCalls.length > 0 ? (
        <div data-testid="feed-end">You’re all caught up</div>
      ) : null}
    </div>
  );
}
