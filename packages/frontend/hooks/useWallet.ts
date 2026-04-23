"use client";

import { useAccount } from "wagmi";
import { useChain } from "@/components/ChainProvider";
import { useStellarWallet } from "@/components/StellarWalletProvider";

/**
 * useWallet Hook
 * 
 * A unified abstraction layer for wallet connection across different chains (Base/EVM and Stellar).
 * Automatically resolves the correct address and connection state based on the currently selected chain.
 */
export function useWallet() {
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { selectedChain } = useChain();
  const { publicKey: stellarAddress, isConnected: isStellarConnected } = useStellarWallet();

  const address = selectedChain === "stellar" ? stellarAddress : evmAddress;
  const isConnected = selectedChain === "stellar" ? isStellarConnected : isEvmConnected;
  const chainType = selectedChain;

  return {
    address,
    isConnected,
    chainType,
    evmAddress,
    isEvmConnected,
    stellarAddress,
    isStellarConnected,
  };
}
