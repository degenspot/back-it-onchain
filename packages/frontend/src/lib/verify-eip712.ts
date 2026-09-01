export interface EIP712Digest {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, unknown>;
  signature: string;
}

export interface StellarEvidence {
  pubkey: string;
  ed25519Signature: string;
}

export interface ProvenanceData {
  finalPrice: number;
  outcome: string;
  oracleAddress: string;
  chain: "base" | "stellar";
  eip712Digest?: EIP712Digest;
  stellarEvidence?: StellarEvidence;
  evidenceCID?: string;
  verified: boolean;
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

export function getExplorerUrl(chain: "base" | "stellar", address: string): string {
  if (chain === "base") {
    return `https://sepolia.basescan.org/address/${address}`;
  }
  return `https://stellar.expert/explorer/public/account/${address}`;
}

export function getIPFSUrl(cid: string): string {
  return `https://ipfs.io/ipfs/${cid}`;
}
