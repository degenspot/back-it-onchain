'use client';

/**
 * Feed personalization prefs (FE-30): muted authors, chain filters, and signal
 * weights, persisted to localStorage.
 */

import * as React from 'react';

export const PREF_KEY = 'feed-personalization';

export interface FeedPrefs {
  mutedAuthors: string[];
  chains: ('base' | 'stellar' | 'all')[];
  /** Relative weight for ranking signals (1 = default). */
  weights: { stake: number; acumen: number; recency: number };
}

const DEFAULT_PREFS: FeedPrefs = {
  mutedAuthors: [],
  chains: ['all'],
  weights: { stake: 1, acumen: 1, recency: 1 },
};

export type FeedPrefsSetter = (update: Partial<FeedPrefs>) => void;

export interface UseFeedPrefsResult {
  prefs: FeedPrefs;
  setPrefs: FeedPrefsSetter;
  resetPrefs: () => void;
}

export function loadFeedPrefs(): FeedPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<FeedPrefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      weights: { ...DEFAULT_PREFS.weights, ...(parsed.weights ?? {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveFeedPrefs(prefs: FeedPrefs): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
}

export function useFeedPrefs(): UseFeedPrefsResult {
  const [prefs, setPrefsState] = React.useState<FeedPrefs>(loadFeedPrefs);

  const setPrefs = React.useCallback((update: Partial<FeedPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...update };
      saveFeedPrefs(next);
      return next;
    });
  }, []);

  const resetPrefs = React.useCallback(() => {
    setPrefsState(DEFAULT_PREFS);
    saveFeedPrefs(DEFAULT_PREFS);
  }, []);

  return { prefs, setPrefs, resetPrefs };
}
