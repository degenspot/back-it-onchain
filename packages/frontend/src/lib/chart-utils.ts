export interface RawChartData {
  timestamp: number;
  price: number;
}

export interface FormattedChartData {
  time: string;
  value: number;
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
