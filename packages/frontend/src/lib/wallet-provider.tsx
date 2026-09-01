"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

export type ChainType = "base" | "stellar";
export type WalletStatus = "connecting" | "connected" | "disconnected" | "unsupported";

interface WalletState {
  chain: ChainType;
  status: WalletStatus;
  address: string | null;
  chainId: number | null;
}

interface WalletContextValue {
  wallet: WalletState;
  connect: (chain: ChainType) => Promise<void>;
  disconnect: () => void;
  switchChain: (chain: ChainType) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const STORAGE_KEY = "backit-wallet-chain";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>({
    chain: "stellar",
    status: "disconnected",
    address: null,
    chainId: null,
  });
  
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ChainType | null;
    if (saved === "base" || saved === "stellar") {
      setWallet(prev => ({ ...prev, chain: saved }));
    }
  }, []);
  
  const connect = useCallback(async (chain: ChainType) => {
    setWallet(prev => ({ ...prev, chain, status: "connecting" }));
    try {
      // Real wallet connection would happen here via wagmi/freighter
      // For now, simulate connection
      await new Promise(resolve => setTimeout(resolve, 500));
      setWallet({
        chain,
        status: "connected",
        address: chain === "base" ? "0xMockAddress" : "GMockAddress",
        chainId: chain === "base" ? 84532 : null,
      });
      localStorage.setItem(STORAGE_KEY, chain);
    } catch {
      setWallet(prev => ({ ...prev, status: "disconnected", address: null, chainId: null }));
    }
  }, []);
  
  const disconnect = useCallback(() => {
    setWallet(prev => ({
      ...prev,
      status: "disconnected",
      address: null,
      chainId: null,
    }));
  }, []);
  
  const switchChain = useCallback(async (chain: ChainType) => {
    setWallet(prev => ({ ...prev, chain }));
    localStorage.setItem(STORAGE_KEY, chain);
    if (wallet.status === "connected") {
      await connect(chain);
    }
  }, [wallet.status, connect]);
  
  return (
    <WalletContext.Provider value={{ wallet, connect, disconnect, switchChain }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWalletContext() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWalletContext must be used within WalletProvider");
  return context;
}
