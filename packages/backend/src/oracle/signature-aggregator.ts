export interface OracleSignature {
  oracleId: string;
  signature: string;
  payload: string;
}

export class OracleSignatureAggregator {
  public verifyQuorum(signatures: OracleSignature[], quorumThreshold: number): boolean {
    if (!signatures || signatures.length < quorumThreshold) {
      return false;
    }
    const uniqueOracles = new Set(signatures.map(s => s.oracleId));
    return uniqueOracles.size >= quorumThreshold;
  }
}
