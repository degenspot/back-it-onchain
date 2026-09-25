import { FeeBumpTransaction, Transaction } from '@stellar/stellar-sdk';

export interface SponsoredEnvelopeRequest {
  innerTransactionXdr: string;
  networkPassphrase: string;
  feeSource?: string;
}

export interface SponsoredTransactionResult {
  signedEnvelopeXdr: string;
  sponsored: boolean;
}

export function buildFeeBumpEnvelope(inner: Transaction, feeSource: string, baseFee = '100'): FeeBumpTransaction {
  if (!feeSource) throw new Error('A relayer fee source is required');
  return new FeeBumpTransaction(inner, feeSource, baseFee);
}

export async function requestSponsoredEnvelope(transaction: Transaction, options: { endpoint?: string; networkPassphrase: string; signal?: AbortSignal }): Promise<string> {
  const endpoint = options.endpoint || '/wallet/sponsor-stellar-transaction';
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionXdr: transaction.toXDR(), networkPassphrase: options.networkPassphrase }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Sponsorship request failed (${response.status})`);
  const payload = await response.json() as { envelopeXdr?: string; signedEnvelopeXdr?: string; transactionXdr?: string };
  const envelope = payload.envelopeXdr || payload.signedEnvelopeXdr || payload.transactionXdr;
  if (!envelope) throw new Error('Sponsorship response did not include an envelope');
  return envelope;
}

export async function signSponsoredEnvelope(transaction: Transaction, signer: { signEnvelopeXdr: (xdr: string) => Promise<string> }, options: { networkPassphrase: string; endpoint?: string; signal?: AbortSignal }): Promise<SponsoredTransactionResult> {
  const sponsoredXdr = await requestSponsoredEnvelope(transaction, options);
  const signedEnvelopeXdr = await signer.signEnvelopeXdr(sponsoredXdr);
  return { signedEnvelopeXdr, sponsored: true };
}

export function isFeeBumpEnvelope(xdr: string): boolean {
  try {
    FeeBumpTransaction.fromXDR(xdr, 'envelope');
    return true;
  } catch {
    return false;
  }
}
