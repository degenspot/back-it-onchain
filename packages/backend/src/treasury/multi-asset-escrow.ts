export type AssetType = 'XLM' | 'SAC_USDC' | 'SAC_EURC';

export interface EscrowDeposit {
  id: string;
  asset: AssetType;
  amount: string;
  depositor: string;
}

export class MultiAssetEscrowManager {
  private deposits: Map<string, EscrowDeposit> = new Map();

  public addDeposit(deposit: EscrowDeposit): EscrowDeposit {
    this.deposits.set(deposit.id, deposit);
    return deposit;
  }

  public getDeposit(id: string): EscrowDeposit | undefined {
    return this.deposits.get(id);
  }
}
