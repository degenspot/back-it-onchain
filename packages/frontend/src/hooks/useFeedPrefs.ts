'use client';

/**
 * Feed personalization prefs (FE-30): muted authors, chain filters, and signal
 * weights, persisted to localStorage.
 */

import * as React from 'react';
import type { Call } from '../../lib/types';

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

function callAuthor(call: Call): string | undefined {
  return call.creator?.wallet ?? call.creatorWallet ?? call.creator?.handle;
}

function callToken(call: Call): string | undefined {
  return call.tokenAddress ?? (typeof call.pairId === 'string' ? call.pairId : undefined);
}

function stakeUsd(call: Call): number {
  const total = Number(call.totalStakeYes || 0) + Number(call.totalStakeNo || 0);
  if (total > 0) return total;
  const numeric = parseFloat(String(call.stakeAmount ?? call.stake ?? ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function engagement(call: Call): number {
  return Number(call.backers || 0) + Number(call.comments || 0);
}

function createdTs(call: Call): number {
  const raw = call.createdAt ?? call.deadline;
  if (raw) {
    const ts = new Date(raw).getTime();
    if (Number.isFinite(ts)) return ts;
  }
  if (call.endTs) {
    const ts = new Date(Number(call.endTs)).getTime();
    if (Number.isFinite(ts)) return ts;
  }
  return 0;
}

function normalize(values: number[]): number[] {
  const max = Math.max(0, ...values);
  if (max <= 0) return values.map(() => 0);
  return values.map((value) => value / max);
}

/**
 * Applies personalization prefs to a set of feed calls (FE-30).
 *
 * Pure so it is trivially testable: mutes by author or token, hides chains
 * that are not selected, and — when the weight sliders are moved off their
 * defaults — re-ranks by stake size, engagement and recency. With default
 * prefs the caller's ordering is preserved.
 */
export function applyFeedPrefs(calls: Call[], prefs: FeedPrefs): Call[] {
  const { mutedAuthors, chains, weights } = prefs;
  const muted = new Set(mutedAuthors.map((m) => m.toLowerCase()));
  const showAllChains = chains.includes('all');
  const now = Date.now();

  const visible = calls.filter((call) => {
    if (muted.size > 0) {
      const author = callAuthor(call);
      const token = callToken(call);
      if (
        (author && muted.has(author.toLowerCase())) ||
        (token && muted.has(token.toLowerCase()))
      ) {
        return false;
      }
    }
    const chain = call.chain;
    // Calls without a known chain only surface when no chain filter is set.
    if (!showAllChains && (!chain || !chains.includes(chain))) return false;
    return true;
  });

  // Neutral weights keep the feed in the order the API returned, so the
  // default experience is unchanged until the user moves a slider.
  const neutral =
    weights.stake === 1 && weights.acumen === 1 && weights.recency === 1;
  if (neutral || visible.length <= 1) return visible;

  const stakes = normalize(visible.map(stakeUsd));
  const engagements = normalize(visible.map(engagement));
  const ages = normalize(
    visible.map((call) => {
      const ts = createdTs(call);
      if (!ts) return 0;
      return Math.max(0, now - ts);
    }),
  );

  return visible
    .map((call, index) => {
      const score =
        weights.stake * stakes[index] +
        weights.acumen * engagements[index] +
        weights.recency * (1 - ages[index]);
      return { call, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.call);
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
