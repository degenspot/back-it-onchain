'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useSignMessage } from 'wagmi';

import { api, setAuthToken } from '../lib/apiClient';
import { fetchNonce, verifySignature } from '../lib/authService';
import { AuthState, Chain } from '@/app';

// ── Freighter (Stellar browser wallet) types ─────────────────────────────────
// The full Freighter SDK can be imported in the actual project; typed minimally
// here so the file compiles without the package installed.
declare global {
  interface Window {
    freighter?: {
      signMessage(message: string): Promise<{ signature: string }>;
    };
  }
}

// ── Context shape ────────────────────────────────────────────────────────────

interface GlobalStateContextValue extends AuthState {
  /**
   * Initiate the signature-auth flow for the given address + chain.
   *
   * Flow:
   *  1. GET  /auth/nonce?address=…   → one-time challenge string
   *  2. Sign the nonce with the wallet (wagmi for Base, Freighter for Stellar)
   *  3. POST /auth/verify            → JWT
   *  4. Store JWT; attach to all subsequent API calls via apiClient
   */
  login: (address: string, chain: Chain) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  error: string | null;
}

const GlobalStateContext = createContext<GlobalStateContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function GlobalStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [auth, setAuth] = useState<AuthState>({
    address: null,
    chain: null,
    jwt: null,
    isAuthenticated: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // wagmi hook — used only for Base (EVM) signing
  const { signMessageAsync } = useSignMessage();

  // ── Base (EVM) signing ──────────────────────────────────────────────────

  const signWithBase = useCallback(
    async (nonce: string): Promise<string> => {
      // signMessageAsync throws if the user rejects — let it bubble naturally
      return signMessageAsync({ message: nonce });
    },
    [signMessageAsync],
  );

  // ── Stellar signing ─────────────────────────────────────────────────────

  const signWithStellar = useCallback(async (nonce: string): Promise<string> => {
    if (!window.freighter) {
      throw new Error('Freighter wallet extension is not installed.');
    }
    const { signature } = await window.freighter.signMessage(nonce);
    return signature;
  }, []);

  // ── login() — replaces deprecated POST /auth/login ──────────────────────

  const login = useCallback(
    async (address: string, chain: Chain) => {
      setIsLoading(true);
      setError(null);

      try {
        // 1. Fetch nonce challenge from backend
        const nonce = await fetchNonce(address);

        // 2. Sign the nonce with the appropriate wallet
        const signature =
          chain === 'base'
            ? await signWithBase(nonce)
            : await signWithStellar(nonce);

        // 3. Exchange signed nonce for a JWT
        const jwt = await verifySignature(address, signature, chain);

        // 4. Persist the token so apiClient attaches it to all future requests
        setAuthToken(jwt);

        setAuth({ address, chain, jwt, isAuthenticated: true });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Authentication failed.';
        setError(message);
        setAuthToken(null);
      } finally {
        setIsLoading(false);
      }
    },
    [signWithBase, signWithStellar],
  );

  // ── logout ───────────────────────────────────────────────────────────────

  const logout = useCallback(() => {
    setAuthToken(null);
    setAuth({ address: null, chain: null, jwt: null, isAuthenticated: false });
    setError(null);
  }, []);

  const value = useMemo<GlobalStateContextValue>(
    () => ({ ...auth, login, logout, isLoading, error }),
    [auth, login, logout, isLoading, error],
  );

  return (
    <GlobalStateContext.Provider value={value}>
      {children}
    </GlobalStateContext.Provider>
  );
}

// ── Consumer hook ─────────────────────────────────────────────────────────────

export function useGlobalState(): GlobalStateContextValue {
  const ctx = useContext(GlobalStateContext);
  if (!ctx) {
    throw new Error('useGlobalState must be used inside <GlobalStateProvider>');
  }
  return ctx;
}