'use client';

import * as React from 'react';

/**
 * Performance utilities (FE-32): measurement + lazy-loading helpers.
 */

const MEASURES: Record<string, number> = {};

/** Marks a named start point for performance timing. */
export function markStart(name: string): void {
  MEASURES[name] = typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Ends a named timing and reports the elapsed ms. */
export function markEnd(name: string): number {
  const start = MEASURES[name];
  if (typeof performance === 'undefined' || start == null) return 0;
  const elapsed = performance.now() - start;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('perf-timing', { detail: { name, ms: elapsed } }));
  }
  delete MEASURES[name];
  return elapsed;
}

/** Defer heavy work to idle so the main thread stays responsive. */
export function deferIdleTask(fn: () => void): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(fn);
  } else {
    setTimeout(fn, 1);
  }
}

export interface DynamicSkeletonOptions {
  loaderLabel?: string;
  minHeight?: number;
  className?: string;
}

/** Shared skeleton element used as the fallback for lazy-loaded chunks. */
export function dynamicSkeleton({
  loaderLabel = 'Loading visuals...',
  minHeight = 120,
  className = '',
}: DynamicSkeletonOptions = {}) {
  return React.createElement(
    'div',
    {
      className: `flex items-center justify-center rounded-lg border border-border bg-card/50 ${className}`,
      style: { minHeight },
      'data-testid': 'dynamic-skeleton',
    },
    React.createElement(
      'span',
      { className: 'text-xs text-muted-foreground' },
      loaderLabel,
    ),
  );
}
