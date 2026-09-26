export interface YieldHarvestResult {
  harvestedAmount: number;
  compoundedBalance: number;
  timestamp: number;
}

export function harvestAndCompound(balance: number, aprPercent: number, daysElapsed: number): YieldHarvestResult {
  const yieldAmount = balance * (aprPercent / 100) * (daysElapsed / 365);
  return {
    harvestedAmount: yieldAmount,
    compoundedBalance: balance + yieldAmount,
    timestamp: Date.now(),
  };
}
