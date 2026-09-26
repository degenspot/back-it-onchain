export class PayoutWithdrawalTracker {
  private claimedPayouts: Map<string, number> = new Map();

  public recordClaim(userAddress: string, amount: number): number {
    const current = this.claimedPayouts.get(userAddress) || 0;
    const updated = current + amount;
    this.claimedPayouts.set(userAddress, updated);
    return updated;
  }

  public getClaimedAmount(userAddress: string): number {
    return this.claimedPayouts.get(userAddress) || 0;
  }
}
