import { computePayout } from './payout-utils';

export interface RawChartData {
  timestamp: number;
  price: number;
}

export interface FormattedChartData {
  time: string;
  value: number;
}

// ── Crosshair target pinning (FE-004) ──────────────────────────────────────

/**
 * Map a pixel Y position within a chart of height `chartHeight` to the price
 * it represents, given the price range `[minPrice, maxPrice]` shown on the
 * axis. Y grows downward (SVG/DOM convention), so the top of the chart is
 * `maxPrice` and the bottom is `minPrice`.
 *
 * Clamped to the visible range rather than extrapolating. A drag that
 * overshoots the chart edge should pin to the edge price, not project an
 * off-chart number the user never saw plotted.
 */
export function priceFromCrosshairY(
  y: number,
  chartHeight: number,
  minPrice: number,
  maxPrice: number,
): number {
  if (chartHeight <= 0 || maxPrice <= minPrice) return minPrice;

  const clampedY = Math.min(Math.max(y, 0), chartHeight);
  const fraction = 1 - clampedY / chartHeight;

  return minPrice + fraction * (maxPrice - minPrice);
}

/** The inverse of {@link priceFromCrosshairY}: where to draw a price line. */
export function crosshairYFromPrice(
  price: number,
  chartHeight: number,
  minPrice: number,
  maxPrice: number,
): number {
  if (maxPrice <= minPrice) return chartHeight / 2;

  const clampedPrice = Math.min(Math.max(price, minPrice), maxPrice);
  const fraction = (clampedPrice - minPrice) / (maxPrice - minPrice);

  return (1 - fraction) * chartHeight;
}

/** Percentage change of `target` relative to `reference`, signed. */
export function percentDelta(target: number, reference: number): number {
  if (!Number.isFinite(reference) || reference === 0) return 0;

  return ((target - reference) / reference) * 100;
}

/**
 * Projected payout multiplier if a stake were placed at the current pool
 * split and the pinned target resolves the market: how many times the
 * stake comes back, before it's actually placed.
 *
 * Delegates to {@link computePayout} rather than re-deriving the parimutuel
 * formula here, so the chart overlay's number always agrees with what
 * WithdrawPayout shows after the fact for the same inputs.
 */
export function projectedPayoutMultiplier(input: {
  userStake: number;
  winningPoolTotal: number;
  losingPoolTotal: number;
  feeBps?: number;
}): number {
  if (input.userStake <= 0) return 0;

  const { net } = computePayout(input);

  return net / input.userStake;
}

export function formatChartData(data: RawChartData[]): FormattedChartData[] {
  return data.map((item) => {
    const date = new Date(item.timestamp);
    const formattedTime = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
    return {
      time: formattedTime,
      value: item.price,
    };
  });
}

// ── Candlestick series (FE-15) ────────────────────────────────────────────────

export interface CandleData {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface EvidenceMarker {
  time: string | number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "circle" | "arrowUp" | "arrowDown";
  text: string;
}

export function buildEvidenceMarkers(events: Array<{ time: string | number; label: string; type: "start" | "end" | "settlement" }>): EvidenceMarker[] {
  return events.map((e) => ({
    time: e.time,
    position: "aboveBar" as const,
    color: e.type === "start" ? "#8b5cf6" : e.type === "end" ? "#ec4899" : "#22c55e",
    shape: e.type === "settlement" ? ("circle" as const) : ("arrowUp" as const),
    text: e.label,
  }));
}

export function generateMockCandleData(days: number = 30): CandleData[] {
  const data: CandleData[] = [];
  let price = 100;
  const now = Math.floor(Date.now() / 1000);
  const daySeconds = 86400;

  for (let i = days; i >= 0; i--) {
    const time = now - i * daySeconds;
    const change = (Math.random() - 0.48) * 10;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 5;
    const low = Math.min(open, close) - Math.random() * 5;
    data.push({
      time: new Date(time * 1000).toISOString().split("T")[0],
      open,
      high,
      low,
      close,
      volume: Math.floor(Math.random() * 10000),
    });
    price = close;
  }
  return data;
}
