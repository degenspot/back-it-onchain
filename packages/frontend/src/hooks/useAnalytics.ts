import { useEffect, useMemo, useState } from 'react';
import type { RawChartData } from '../lib/chart-utils';
import type { RadarAxis } from '../lib/analytics-utils';

export interface AnalyticsData {
  wallet: string;
  reputation: RadarAxis[];
  /** Accuracy over time in the RawChartData shape so chart-utils can format it. */
  accuracy: RawChartData[];
  pnl: RawChartData[];
  stakingVolume: { label: string; value: number }[];
}

export interface UseAnalyticsResult {
  data: AnalyticsData | null;
  loading: boolean;
}

/** Small deterministic string hash so mock data is stable per wallet. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 0–1 PRNG derived from a seed (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure builder — exported so it can be unit tested without React. */
export function buildMockAnalytics(wallet: string): AnalyticsData {
  const rand = seeded(hashSeed(wallet || 'anon'));
  const pick = (min: number, max: number) =>
    Math.round(min + rand() * (max - min));

  const reputation: RadarAxis[] = [
    { label: 'Accuracy', value: pick(40, 98) },
    { label: 'Volume', value: pick(30, 95) },
    { label: 'Conviction', value: pick(35, 96) },
    { label: 'Brier calibration', value: pick(25, 90) },
    { label: 'Category breadth', value: pick(20, 92) },
    { label: 'Recency', value: pick(30, 98) },
  ];

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  let acc = pick(45, 65);
  const accuracy: RawChartData[] = Array.from({ length: 30 }, (_, i) => {
    acc = Math.max(0, Math.min(100, acc + (rand() * 10 - 4)));
    return { timestamp: now - (29 - i) * day, price: Math.round(acc) };
  });

  let pnlValue = 0;
  const pnl: RawChartData[] = Array.from({ length: 30 }, (_, i) => {
    pnlValue += Math.round((rand() * 80 - 30) * 100) / 100;
    return { timestamp: now - (29 - i) * day, price: pnlValue };
  });

  const stakingVolume = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'].map((label) => ({
    label,
    value: pick(50, 1000),
  }));

  return { wallet, reputation, accuracy, pnl, stakingVolume };
}

/**
 * Mock analytics data layer. Returns deterministic-per-wallet reputation,
 * accuracy-over-time, and staking-volume data with a brief simulated load so
 * the UI can exercise its loading state.
 */
export function useAnalytics(wallet: string): UseAnalyticsResult {
  const [loading, setLoading] = useState(true);
  const data = useMemo(() => buildMockAnalytics(wallet), [wallet]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(t);
  }, [wallet]);

  return { data: loading ? null : data, loading };
}
