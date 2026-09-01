"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, createSeriesMarkers, CandlestickSeries, type IChartApi, type ISeriesApi, type CandlestickData, type Time, type SeriesMarker, ColorType } from "lightweight-charts";
import { cn } from "@/lib/utils";
import { generateMockCandleData, buildEvidenceMarkers, type EvidenceMarker } from "@/lib/chart-utils";

type Timeframe = "1H" | "24H" | "7D";

interface PriceChartProps {
  callId?: string;
  evidenceEvents?: Array<{ time: string | number; label: string; type: "start" | "end" | "settlement" }>;
  className?: string;
}

export function PriceChart({ callId, evidenceEvents, className }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("7D");

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: "#2d2d3d" },
        horzLines: { color: "#2d2d3d" },
      },
      crosshair: {
        vertLine: { color: "#8b5cf6", width: 1, style: 2 },
        horzLine: { color: "#8b5cf6", width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: "#2d2d3d",
      },
      timeScale: {
        borderColor: "#2d2d3d",
        timeVisible: true,
      },
      width: chartContainerRef.current.clientWidth,
      height: 350,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      wickUpColor: "#22c55e",
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    // Generate and set data
    const days = timeframe === "1H" ? 1 : timeframe === "24H" ? 1 : 7;
    const data = generateMockCandleData(days);
    candlestickSeries.setData(data as CandlestickData<Time>[]);

    // Add evidence markers
    if (evidenceEvents && evidenceEvents.length > 0) {
      const markers = buildEvidenceMarkers(evidenceEvents);
      const seriesMarkers = createSeriesMarkers(candlestickSeries);
      seriesMarkers.setMarkers(markers as SeriesMarker<Time>[]);
    }

    chart.timeScale().fitContent();

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        chart.applyOptions({ width });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [timeframe, evidenceEvents]);

  return (
    <div className={cn("space-y-2", className)} data-testid="price-chart">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Price History</span>
        <div className="flex gap-1 ml-auto">
          {(["1H", "24H", "7D"] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-colors",
                timeframe === tf
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
              data-testid={`timeframe-${tf}`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>
      <div ref={chartContainerRef} className="rounded-xl border border-border overflow-hidden" />
    </div>
  );
}
