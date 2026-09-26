'use client';

import * as React from 'react';
import { AreaSeries, createChart } from 'lightweight-charts';
import {
  buildPnlSeries,
  buildReputationSeries,
  summarize,
  type CallHistoryEntry,
  type TimelinePoint,
} from '../lib/reputation';

export type TimelineMetric = 'reputation' | 'pnl';
export type TimelineRange = '1W' | '1M' | '3M' | '1Y' | 'ALL';

/** The slice of lightweight-charts this component uses, so tests can fake it. */
export interface ChartSeriesHandle {
  setData(data: TimelinePoint[]): void;
  applyOptions?(options: Record<string, unknown>): void;
}

export interface ChartHandle {
  addSeries(definition: unknown, options?: Record<string, unknown>): ChartSeriesHandle;
  timeScale(): { fitContent(): void };
  applyOptions?(options: Record<string, unknown>): void;
  remove(): void;
}

export type ChartFactory = (
  container: HTMLElement,
  options?: Record<string, unknown>,
) => ChartHandle;

export interface ReputationTimelineProps {
  entries: CallHistoryEntry[];
  /** Score the backend reports today; the series is walked back from history. */
  currentScore?: number;
  startingScore?: number;
  height?: number;
  metric?: TimelineMetric;
  onMetricChange?: (metric: TimelineMetric) => void;
  range?: TimelineRange;
  onRangeChange?: (range: TimelineRange) => void;
  chartFactory?: ChartFactory;
  seriesDefinition?: unknown;
}

const defaultChartFactory: ChartFactory = (container, options) =>
  createChart(container, options as never) as unknown as ChartHandle;

function outcomeLabel(entry: CallHistoryEntry): string {
  if (entry.outcome === 'open') return 'Open';

  return entry.outcome === 'won' ? 'Won' : 'Lost';
}

function formatMoney(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';

  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/**
 * Reputation / PnL chart plus the call-history timeline it is built from
 * (FE-07).
 *
 * The chart is created once and only its data is swapped when the metric
 * changes — tearing down and rebuilding on every toggle loses the user's pan
 * and zoom.
 */
export function ReputationTimeline({
  entries,
  currentScore = 0,
  startingScore = 0,
  height = 220,
  metric: controlledMetric,
  onMetricChange,
  range: controlledRange,
  onRangeChange,
  chartFactory = defaultChartFactory,
  seriesDefinition = AreaSeries,
}: ReputationTimelineProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const seriesRef = React.useRef<ChartSeriesHandle | null>(null);
  const chartRef = React.useRef<ChartHandle | null>(null);

  const [uncontrolledMetric, setUncontrolledMetric] = React.useState<TimelineMetric>('reputation');
  const [uncontrolledRange, setUncontrolledRange] = React.useState<TimelineRange>('ALL');
  const metric = controlledMetric ?? uncontrolledMetric;
  const range = controlledRange ?? uncontrolledRange;
  const filteredEntries = React.useMemo(() => {
    if (range === 'ALL') return entries;
    const days = range === '1W' ? 7 : range === '1M' ? 30 : range === '3M' ? 90 : 365;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return entries.filter((entry) => Date.parse(entry.resolvedAt ?? entry.createdAt) >= cutoff);
  }, [entries, range]);

  const summary = React.useMemo(() => summarize(filteredEntries, currentScore), [currentScore, filteredEntries]);

  const data = React.useMemo(
    () =>
      metric === 'reputation'
        ? buildReputationSeries(filteredEntries, startingScore)
        : buildPnlSeries(filteredEntries),
    [filteredEntries, metric, startingScore],
  );

  React.useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const chart = chartFactory(container, { height, autoSize: true });

    chartRef.current = chart;
    seriesRef.current = chart.addSeries(seriesDefinition, { lineWidth: 2 });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [chartFactory, height, seriesDefinition]);

  React.useEffect(() => {
    seriesRef.current?.setData(data);

    // An unfitted scale opens on an arbitrary window; with a handful of points
    // that usually means an apparently empty chart.
    if (data.length > 0) chartRef.current?.timeScale().fitContent();
  }, [data]);

  const selectMetric = (next: TimelineMetric) => {
    setUncontrolledMetric(next);
    onMetricChange?.(next);
  };

  const selectRange = (next: TimelineRange) => {
    setUncontrolledRange(next);
    onRangeChange?.(next);
  };

  return (
    <section data-testid="reputation-timeline" className="rounded-xl border border-border p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Reputation</h2>

        <div role="group" aria-label="Timeline metric" className="flex gap-1 text-xs">
          {(['reputation', 'pnl'] as TimelineMetric[]).map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`timeline-metric-${option}`}
              aria-pressed={metric === option}
              onClick={() => selectMetric(option)}
              className={
                metric === option
                  ? 'rounded-full bg-primary px-3 py-1 text-primary-foreground'
                  : 'rounded-full border border-border px-3 py-1'
              }
            >
              {option === 'reputation' ? 'Score' : 'PnL'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Range
          <select value={range} onChange={(event) => selectRange(event.target.value as TimelineRange)} className="rounded border border-border bg-background px-2 py-1 text-foreground">
            {(['1W', '1M', '3M', '1Y', 'ALL'] as TimelineRange[]).map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd data-testid="summary-score" className="text-xl font-bold">
            {summary.currentScore}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Win rate</dt>
          <dd data-testid="summary-win-rate" className="text-xl font-bold">
            {`${Math.round(summary.winRate * 100)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Net PnL</dt>
          <dd data-testid="summary-pnl" className="text-xl font-bold">
            {formatMoney(summary.netPnl)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Calls</dt>
          <dd data-testid="summary-total" className="text-xl font-bold">
            {summary.totalCalls}
          </dd>
        </div>
      </dl>

      <div
        ref={containerRef}
        data-testid="reputation-chart"
        style={{ height }}
        className="w-full"
      />

      {data.length === 0 ? (
        <p data-testid="timeline-empty" className="py-6 text-center text-sm text-muted-foreground">
          No call history yet.
        </p>
      ) : (
        <ol data-testid="timeline-history" className="mt-4 divide-y divide-border">
          {[...filteredEntries].reverse().map((entry) => (
            <li
              key={entry.id}
              data-testid={`timeline-entry-${entry.id}`}
              className="flex items-center justify-between py-2 text-sm"
            >
              <span className="flex flex-col">
                <span className="font-medium">
                  {entry.token} {entry.direction === 'up' ? '↑' : '↓'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {(entry.resolvedAt ?? entry.createdAt).slice(0, 10)} · {outcomeLabel(entry)}
                </span>
              </span>

              <span
                data-testid={`timeline-pnl-${entry.id}`}
                className={entry.pnl >= 0 ? 'text-green-600' : 'text-red-600'}
              >
                {formatMoney(entry.pnl)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default ReputationTimeline;
