import { CandlestickData, Time, AreaData } from "lightweight-charts";

/**
 * Generate mock price history data for candlestick charts
 */
export function generateMockPriceData(startPrice: number, days: number = 30): CandlestickData[] {
  const data: CandlestickData[] = [];
  let currentPrice = startPrice;
  const now = new Date();
  
  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    // Random price movement
    const volatility = 0.02; // 2% volatility
    const change = (Math.random() - 0.5) * 2 * volatility;
    const open = currentPrice;
    const close = currentPrice * (1 + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    
    data.push({
      time: date.toISOString().split("T")[0] as Time,
      open: parseFloat(open.toFixed(6)),
      high: parseFloat(high.toFixed(6)),
      low: parseFloat(low.toFixed(6)),
      close: parseFloat(close.toFixed(6)),
    });
    
    currentPrice = close;
  }
  
  return data;
}

/**
 * Generate area data for area charts (smoother look)
 */
export function generateAreaData(startPrice: number, days: number = 30): AreaData[] {
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
