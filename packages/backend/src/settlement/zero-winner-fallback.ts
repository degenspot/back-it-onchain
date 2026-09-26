export interface RefundParticipant {
  address: string;
  stakedAmount: number;
}

export function calculateProRataRefund(participants: RefundParticipant[], poolTotal: number): Map<string, number> {
  const result = new Map<string, number>();
  const totalStaked = participants.reduce((acc, p) => acc + p.stakedAmount, 0);
  if (totalStaked === 0) return result;

  for (const p of participants) {
    const refund = (p.stakedAmount / totalStaked) * poolTotal;
    result.set(p.address, Math.floor(refund));
  }
  return result;
}
