export interface StakerRebateInfo {
  predictorId: string;
  reputationScore: number;
  rebatePercentage: number;
}

export function calculateStakerRebate(predictorId: string, reputationScore: number): StakerRebateInfo {
  let rebatePercentage = 0;
  if (reputationScore >= 90) rebatePercentage = 25;
  else if (reputationScore >= 75) rebatePercentage = 15;
  else if (reputationScore >= 50) rebatePercentage = 5;

  return {
    predictorId,
    reputationScore,
    rebatePercentage,
  };
}
