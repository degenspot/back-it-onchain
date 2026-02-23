"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";

/**
 * Supported blockchain networks
 */
export type Chain = "base" | "stellar";

/**
 * Chain context value interface
 */
interface ChainContextValue {
  selectedChain: Chain;
  setSelectedChain: (chain: Chain) => void;
  isChainLoaded: boolean;
}

const STORAGE_KEY = "backit_selected_chain";

const ChainContext = createContext<ChainContextValue | undefined>(undefined);

interface ChainProviderProps {
  children: ReactNode;
}

/**
 * ChainProvider Component
 *
 * Provides chain selection state across the application.
 * Persists selection to localStorage for cross-page and refresh persistence.
 */
export function ChainProvider({ children }: ChainProviderProps) {
  // Default to Stellar so users avoid "Wrong Network" modal on first load; sync with storage in effect
  const [selectedChain, setSelectedChainState] = useState<Chain>("stellar");
  const [isChainLoaded, setIsChainLoaded] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "base" || stored === "stellar") {
        setSelectedChainState(stored);
      }
    }
    setIsChainLoaded(true);
  }, []);

  // Persist chain selection to localStorage
  const setSelectedChain = useCallback((chain: Chain) => {
    setSelectedChainState(chain);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, chain);
    }
  }, []);

  return (
    <ChainContext.Provider
      value={{ selectedChain, setSelectedChain, isChainLoaded }}
    >
      {children}
    </ChainContext.Provider>
  );
}

/**
 * Hook to access chain context
 */
export function useChain(): ChainContextValue {
  const context = useContext(ChainContext);
  if (!context) {
    throw new Error("useChain must be used within ChainProvider");
  }
  return context;
}
