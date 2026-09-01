"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

export type ChainType = "base" | "stellar";

interface ChainContextValue {
  chain: ChainType;
  setChain: (chain: ChainType) => void;
  isHydrated: boolean;
}

const ChainContext = createContext<ChainContextValue | null>(null);

const STORAGE_KEY = "backit-chain";

export function ChainContextProvider({ children }: { children: React.ReactNode }) {
  const [chain, setChainState] = useState<ChainType>("stellar");
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Hydrate from localStorage
    const saved = localStorage.getItem(STORAGE_KEY) as ChainType | null;
    if (saved === "base" || saved === "stellar") {
      setChainState(saved);
    }
    // Also check URL params
    const params = new URLSearchParams(window.location.search);
    const urlChain = params.get("chain") as ChainType | null;
    if (urlChain === "base" || urlChain === "stellar") {
      setChainState(urlChain);
      localStorage.setItem(STORAGE_KEY, urlChain);
    }
    setIsHydrated(true);
  }, []);

  const setChain = useCallback((newChain: ChainType) => {
    setChainState(newChain);
    localStorage.setItem(STORAGE_KEY, newChain);
    // Update URL without reload
    const url = new URL(window.location.href);
    url.searchParams.set("chain", newChain);
    window.history.replaceState({}, "", url.toString());
  }, []);

  return (
    <ChainContext.Provider value={{ chain, setChain, isHydrated }}>
      {children}
    </ChainContext.Provider>
  );
}

export function useChain() {
  const context = useContext(ChainContext);
  if (!context) throw new Error("useChain must be used within ChainContextProvider");
  return context;
}
