"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, AreaData, AreaSeries } from "lightweight-charts";
import { cn } from "@/lib/utils";

interface PriceChartProps {
  asset: string;
  target: string;
  startPrice?: number;
  targetPrice?: number;
  className?: string;
}

// Generate mock price history data

// Generate area data for a smoother look
function generateAreaData(startPrice: number, days: number = 30): AreaData[] {
  const data: AreaData[] = [];
  let currentPrice = startPrice;
  const now = new Date();
  
  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    const volatility = 0.015;
    const change = (Math.random() - 0.5) * 2 * volatility;
    currentPrice = currentPrice * (1 + change);
    
    data.push({
      time: date.toISOString().split("T")[0] as Time,
      value: parseFloat(currentPrice.toFixed(6)),
    });
  }
  
  return data;
}

export function PriceChart({ 
  asset, 
  target, 
  startPrice = 0.12, 
  targetPrice = 0.15,
  className 
}: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [currentPrice, setCurrentPrice] = useState(startPrice);
  const [priceChange, setPriceChange] = useState(0);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8",
        fontFamily: "Geist, sans-serif",
      },
      grid: {
        vertLines: { color: "#2d2d3d", style: 1 },
        horzLines: { color: "#2d2d3d", style: 1 },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: "#8b5cf6",
          width: 1,
          style: 2,
          labelBackgroundColor: "#8b5cf6",
        },
        horzLine: {
          color: "#8b5cf6",
          width: 1,
          style: 2,
          labelBackgroundColor: "#8b5cf6",
        },
      },
      rightPriceScale: {
        borderColor: "#2d2d3d",
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: "#2d2d3d",
        timeVisible: false,
        secondsVisible: false,
      },
      autoSize: true,
    });

    chartRef.current = chart;

    // Create area series using addSeries with AreaSeries type
    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: "#8b5cf6",
      topColor: "rgba(139, 92, 246, 0.4)",
      bottomColor: "rgba(139, 92, 246, 0.05)",
      lineWidth: 2,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#8b5cf6",
      crosshairMarkerBackgroundColor: "#0a0a0f",
    });

    seriesRef.current = areaSeries;

    // Generate and set data
    const data = generateAreaData(startPrice);
    areaSeries.setData(data);
    
    // Update current price
    const latestPrice = data[data.length - 1].value;
    setCurrentPrice(latestPrice);
    setPriceChange(((latestPrice - startPrice) / startPrice) * 100);

    // Add price line for start price
    areaSeries.createPriceLine({
      price: startPrice,
      color: "#22c55e",
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "Start",
    });

    // Add price line for target price
    areaSeries.createPriceLine({
      price: targetPrice,
      color: "#ec4899",
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "Target",
    });

    chart.timeScale().fitContent();

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [startPrice, targetPrice]);

  const isPositive = priceChange >= 0;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">
              {asset}/{target}
            </h3>
            <p className="text-xs text-muted-foreground">Price Chart</p>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-foreground">
              ${currentPrice.toFixed(6)}
            </span>
            <span className={cn(
              "text-sm font-medium",
              isPositive ? "text-green-500" : "text-red-500"
            )}>
              {isPositive ? "+" : ""}{priceChange.toFixed(2)}%
            </span>
          </div>
        </div>
        
        {/* Legend */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-green-500 border-dashed" style={{ borderTop: "2px dashed #22c55e" }} />
            <span className="text-muted-foreground">Start: ${startPrice.toFixed(6)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-pink-500 border-dashed" style={{ borderTop: "2px dashed #ec4899" }} />
            <span className="text-muted-foreground">Target: ${targetPrice.toFixed(6)}</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div 
        ref={chartContainerRef} 
        className="w-full h-[300px] rounded-lg border border-border bg-card/50"
      />
    </div>
  );
}
