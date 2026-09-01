import { useState, useCallback, useEffect } from "react";

export type ChainType = "base" | "stellar";
export type WalletStatus = "connecting" | "connected" | "disconnected" | "unsupported";

const STORAGE_KEY = "backit-wallet-chain";

export function useWallet() {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainType>("stellar");
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [chainId, setChainId] = useState<number | null>(null);
  
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ChainType | null;
    if (saved === "base" || saved === "stellar") {
      setChain(saved);
    }
    // URL sync
    const params = new URLSearchParams(window.location.search);
    const urlChain = params.get("chain") as ChainType | null;
    if (urlChain === "base" || urlChain === "stellar") {
      setChain(urlChain);
      localStorage.setItem(STORAGE_KEY, urlChain);
    }
  }, []);
  
  const connect = useCallback(async (targetChain?: ChainType) => {
    const chainToUse = targetChain ?? chain;
    setChain(chainToUse);
    setStatus("connecting");
    try {
      // Simulate connection
      await new Promise(resolve => setTimeout(resolve, 500));
      setIsConnected(true);
      setAddress(chainToUse === "base" ? "0xMockAddress" : "GMockAddress");
      setChainId(chainToUse === "base" ? 84532 : null);
      setStatus("connected");
      localStorage.setItem(STORAGE_KEY, chainToUse);
    } catch {
      setStatus("disconnected");
    }
  }, [chain]);
  
  const disconnect = useCallback(() => {
    setIsConnected(false);
    setAddress(null);
    setChainId(null);
    setStatus("disconnected");
  }, []);
  
  const switchChain = useCallback(async (newChain: ChainType) => {
    setChain(newChain);
    localStorage.setItem(STORAGE_KEY, newChain);
    if (isConnected) {
      await connect(newChain);
    }
  }, [isConnected, connect]);
  
  return {
    isConnected,
    address,
    chain,
    chainId,
    status,
    connect,
    disconnect,
    switchChain,
  };
}
