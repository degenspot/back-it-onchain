import { api } from './apiClient';

interface NonceResponse {
  nonce: string;
}

interface VerifyResponse {
  access_token: string;
}

/**
 * Step 1 — fetch a one-time nonce for the given wallet address.
 * Replaces the old GET /auth/nonce call so it's centralised here.
 */
export async function fetchNonce(address: string): Promise<string> {
  const { nonce } = await api.get<NonceResponse>(
    `/auth/nonce?address=${encodeURIComponent(address)}`,
  );
  return nonce;
}

/**
 * Step 2 — submit the signed nonce.
 * Returns the JWT issued by the backend AuthController.
 */
export async function verifySignature(
  address: string,
  signature: string,
  chain: 'base' | 'stellar',
): Promise<string> {
  const { access_token } = await api.post<VerifyResponse>('/auth/verify', {
    address,
    signature,
    chain,
  });
  return access_token;
}