import type { RadarAxis } from './analytics-utils';

export type CallOutcome = 'won' | 'lost' | 'open';

export interface CallHistoryEntry {
  id: string;
  token: string;
  direction: 'up' | 'down';
  /** Amount staked, in the call's quote currency. */
  stake: number;
  /** Realized profit or loss. Zero while the call is still open. */
  pnl: number;
  /** Reputation points gained or lost when the call resolved. */
  reputationDelta: number;
  outcome: CallOutcome;
  createdAt: string;
  resolvedAt?: string;
  note?: string;
  predictedProbability?: number;
  category?: string;
}

export interface TimelinePoint {
  /** `YYYY-MM-DD`, the business-day form lightweight-charts accepts. */
  time: string;
  value: number;
}

export interface ReputationSummary {
  totalCalls: number;
  wins: number;
  losses: number;
  open: number;
  /** Share of *resolved* calls that won, 0–1. Zero when nothing has resolved. */
  winRate: number;
  netPnl: number;
  currentScore: number;
}

export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/** The moment a call counts toward reputation — resolution, or creation while open. */
export function effectiveDate(entry: CallHistoryEntry): string {
  return entry.resolvedAt ?? entry.createdAt;
}

export function toBusinessDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function sortHistory(entries: CallHistoryEntry[]): CallHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const delta = Date.parse(effectiveDate(a)) - Date.parse(effectiveDate(b));

    // Ties broken by id so the series is stable across renders.
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

export function clampScore(score: number): number {
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, score));
}

/**
 * Collapse a cumulative walk into one point per day.
 *
 * lightweight-charts rejects a series whose times are not strictly ascending,
 * and several calls resolving on one day is the normal case — so the last
 * value of each day wins rather than the whole series being dropped.
 */
function collapseByDay(points: TimelinePoint[]): TimelinePoint[] {
  const byDay = new Map<string, number>();

  for (const point of points) byDay.set(point.time, point.value);

  return [...byDay.entries()]
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Running reputation score, clamped to the 0–100 the backend reports. */
export function buildReputationSeries(
  entries: CallHistoryEntry[],
  startingScore = 0,
): TimelinePoint[] {
  let score = clampScore(startingScore);

  const points = sortHistory(entries).map((entry) => {
    score = clampScore(score + entry.reputationDelta);

    return { time: toBusinessDay(effectiveDate(entry)), value: score };
  });

  return collapseByDay(points);
}

/** Running realized PnL — the sparkline on the profile. */
export function buildPnlSeries(entries: CallHistoryEntry[]): TimelinePoint[] {
  let total = 0;

  const points = sortHistory(entries).map((entry) => {
    total = roundMoney(total + entry.pnl);

    return { time: toBusinessDay(effectiveDate(entry)), value: total };
  });

  return collapseByDay(points);
}

/** Cents, not float noise: 0.1 + 0.2 has no business reaching the UI. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarize(entries: CallHistoryEntry[], currentScore = 0): ReputationSummary {
  const wins = entries.filter((entry) => entry.outcome === 'won').length;
  const losses = entries.filter((entry) => entry.outcome === 'lost').length;
  const open = entries.filter((entry) => entry.outcome === 'open').length;
  const resolved = wins + losses;

  return {
    totalCalls: entries.length,
    wins,
    losses,
    open,
    winRate: resolved === 0 ? 0 : wins / resolved,
    netPnl: roundMoney(entries.reduce((total, entry) => total + entry.pnl, 0)),
    currentScore: clampScore(currentScore),
  };
}

export const EXPORT_COLUMNS = [
  'id',
  'token',
  'direction',
  'stake',
  'pnl',
  'reputationDelta',
  'outcome',
  'createdAt',
  'resolvedAt',
  'note',
] as const;

/**
 * RFC 4180 quoting.
 *
 * A note reading `Sold, then regretted it` would otherwise shift every later
 * column by one and silently corrupt the export.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = String(value);

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(entries: CallHistoryEntry[]): string {
  const rows = entries.map((entry) =>
    EXPORT_COLUMNS.map((column) => escapeCsvField(entry[column])).join(','),
  );

  return [EXPORT_COLUMNS.join(','), ...rows].join('\n');
}

export function toJson(entries: CallHistoryEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export type ExportFormat = 'csv' | 'json';

export const MIME_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
};

export function serializeHistory(entries: CallHistoryEntry[], format: ExportFormat): string {
  return format === 'csv' ? toCsv(entries) : toJson(entries);
}

/** `backitonchain-history-0xabc1234-2026-08-21.csv` */
export function exportFilename(wallet: string, format: ExportFormat, isoDate: string): string {
  const safeWallet = wallet.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'wallet';

  return `backitonchain-history-${safeWallet}-${isoDate.slice(0, 10)}.${format}`;
}

export type ReputationMetricKey = 'accuracy' | 'volume' | 'conviction' | 'brier' | 'breadth' | 'recency';

export interface ReputationMetrics {
  accuracy: number;
  volume: number;
  conviction: number;
  brier: number;
  breadth: number;
  recency: number;
}

export function calculateBrierScore(entries: CallHistoryEntry[]): number {
  const scored = entries.filter((entry) => typeof entry.predictedProbability === 'number' && entry.outcome !== 'open');
  if (scored.length === 0) return 0.5;
  const score = scored.reduce((total, entry) => {
    const probability = Math.min(1, Math.max(0, entry.predictedProbability as number));
    const actual = entry.outcome === 'won' ? 1 : 0;
    return total + Math.pow(probability - actual, 2);
  }, 0) / scored.length;
  return Math.min(1, Math.max(0, score));
}

export function percentileRank(value: number, population: number[]): number {
  if (population.length === 0) return 0;
  const below = population.filter((entry) => entry <= value).length;
  return Math.round((below / population.length) * 100);
}

export function buildReputationMetrics(entries: CallHistoryEntry[], population: Partial<Record<ReputationMetricKey, number[]>> = {}): ReputationMetrics {
  const resolved = entries.filter((entry) => entry.outcome !== 'open');
  const wins = resolved.filter((entry) => entry.outcome === 'won').length;
  const accuracy = resolved.length === 0 ? 0 : wins / resolved.length;
  const volume = entries.reduce((total, entry) => total + Math.max(0, entry.stake), 0);
  const conviction = entries.length === 0 ? 0 : entries.reduce((total, entry) => total + Math.min(1, entry.stake / 1000), 0) / entries.length;
  const brier = calculateBrierScore(entries);
  const breadth = new Set(entries.map((entry) => entry.category).filter(Boolean)).size;
  const latest = entries.length === 0 ? 0 : Math.max(...entries.map((entry) => Date.parse(effectiveDate(entry)) || 0));
  const recency = latest === 0 ? 0 : Math.exp(-Math.max(0, Date.now() - latest) / (1000 * 60 * 60 * 24 * 90));
  const scale = (value: number, values?: number[]): number => values && values.length > 0 ? percentileRank(value, values) : Math.min(100, Math.max(0, value * 100));
  return {
    accuracy: scale(accuracy, population.accuracy),
    volume: scale(volume, population.volume),
    conviction: scale(conviction, population.conviction),
    brier: scale(1 - brier, population.brier),
    breadth: scale(breadth, population.breadth),
    recency: scale(recency, population.recency),
  };
}

export function metricsToRadarAxes(metrics: ReputationMetrics): RadarAxis[] {
  return [
    { label: 'Accuracy', value: metrics.accuracy },
    { label: 'Volume', value: metrics.volume },
    { label: 'Conviction', value: metrics.conviction },
    { label: 'Brier calibration', value: metrics.brier },
    { label: 'Category breadth', value: metrics.breadth },
    { label: 'Recency', value: metrics.recency },
  ];
}
