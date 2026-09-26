export class ReplayDefense {
  private processedDigests: Set<string> = new Set();
  private accountNonces: Map<string, number> = new Map();

  public verifyAndRecord(account: string, digest: string, expectedNonce: number): boolean {
    if (this.processedDigests.has(digest)) {
      throw new Error('Replay attack detected: Digest already processed');
    }
    const currentNonce = this.accountNonces.get(account) || 0;
    if (expectedNonce !== currentNonce + 1) {
      throw new Error('Invalid nonce sequence');
    }

    this.processedDigests.add(digest);
    this.accountNonces.set(account, expectedNonce);
    return true;
  }
}
