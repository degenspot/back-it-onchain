export interface SettlementBatchItem {
  id: string;
  payoutAmount: number;
}

export function optimizeSettlementBatch(items: SettlementBatchItem[]): SettlementBatchItem[] {
  if (!items || items.length === 0) return [];
  // Sort descending by payout to optimize execution path
  return [...items].sort((a, b) => b.payoutAmount - a.payoutAmount);
}
