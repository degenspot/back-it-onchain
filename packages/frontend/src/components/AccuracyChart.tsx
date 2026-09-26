import * as React from 'react';
import { formatChartData, type RawChartData } from '../lib/chart-utils';

export type AccuracyTimeRange = '1W' | '1M' | '3M' | '1Y' | 'ALL';

export interface AccuracyChartProps {
  data: RawChartData[];
  pnlData?: RawChartData[];
  benchmark?: number;
  width?: number;
  height?: number;
  timeRange?: AccuracyTimeRange;
  onTimeRangeChange?: (range: AccuracyTimeRange) => void;
}

function points(values: number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function rangeDuration(range: AccuracyTimeRange): number | null {
  if (range === 'ALL') return null;
  const days = range === '1W' ? 7 : range === '1M' ? 30 : range === '3M' ? 90 : 365;
  return days * 24 * 60 * 60 * 1000;
}

function filterRange(data: RawChartData[], range: AccuracyTimeRange): RawChartData[] {
  const duration = rangeDuration(range);
  if (!duration || data.length === 0) return data;
  const cutoff = Date.now() - duration;
  return data.filter((point) => point.timestamp >= cutoff);
}

function valueFor(point: RawChartData): number {
  return point.price;
}

export function AccuracyChart({
  data,
  pnlData = [],
  benchmark = 50,
  width = 640,
  height = 220,
  timeRange = 'ALL',
  onTimeRangeChange,
}: AccuracyChartProps) {
  const accuracy = filterRange(data, timeRange);
  const pnl = filterRange(pnlData, timeRange);
  const accuracyValues = accuracy.map(valueFor);
  const pnlValues = pnl.map(valueFor);
  const accuracyPoints = points(accuracyValues, width, height);
  const pnlPoints = points(pnlValues, width, height);
  const benchmarkValues = accuracyValues.length > 0 ? accuracyValues.map(() => benchmark) : [];
  const benchmarkPoints = points(benchmarkValues, width, height);
  const formatted = formatChartData(accuracy);
  const latest = formatted[formatted.length - 1];

  return (
    <div className="space-y-2" data-testid="accuracy-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Accuracy</span>
          {pnl.length > 0 ? <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" /> PnL</span> : null}
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-zinc-500" /> Benchmark</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Range
          <select value={timeRange} onChange={(event) => onTimeRangeChange?.(event.target.value as AccuracyTimeRange)} className="rounded border border-border bg-background px-2 py-1 text-foreground">
            {(['1W', '1M', '3M', '1Y', 'ALL'] as AccuracyTimeRange[]).map((range) => <option key={range}>{range}</option>)}
          </select>
        </label>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Prediction accuracy and profit timeline" preserveAspectRatio="none">
        <polyline points={accuracyPoints} fill="none" stroke="rgb(52,211,153)" strokeWidth={2} />
        {pnlPoints ? <polyline points={pnlPoints} fill="none" stroke="rgb(56,189,248)" strokeWidth={2} /> : null}
        {benchmarkPoints ? <polyline points={benchmarkPoints} fill="none" stroke="rgb(113,113,122)" strokeWidth={1} strokeDasharray="4 4" /> : null}
      </svg>
      {latest ? <p className="text-right text-xs text-zinc-400">Latest accuracy: <span className="text-emerald-400">{latest.value}%</span> · {latest.time}</p> : <p className="text-center text-xs text-muted-foreground">No accuracy history yet.</p>}
    </div>
  );
}

export default AccuracyChart;
