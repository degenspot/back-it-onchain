export interface CreatorRoyaltyDispersal {
  creatorAddress: string;
  royaltyAmount: number;
  timestamp: number;
}

export function calculateCreatorRoyalty(poolVolume: number, royaltyBps: number = 250): number {
  return (poolVolume * royaltyBps) / 10000;
}
