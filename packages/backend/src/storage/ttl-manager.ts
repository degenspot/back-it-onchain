export interface StorageTtlStatus {
  key: string;
  currentLedger: number;
  expirationLedger: number;
  needsExtension: boolean;
}

export function evaluateStorageTtl(key: string, currentLedger: number, expirationLedger: number, thresholdLedgers: number = 1000): StorageTtlStatus {
  const remaining = expirationLedger - currentLedger;
  return {
    key,
    currentLedger,
    expirationLedger,
    needsExtension: remaining < thresholdLedgers,
  };
}
