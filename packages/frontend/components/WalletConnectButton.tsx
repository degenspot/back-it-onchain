/**
 * Wallet Connect Button Component
 *
 * Multi-chain wallet connection button that works with both Base and Stellar.
 * Uses OnchainKit for Base wallet connection and custom Freighter integration for Stellar.
 */

"use client";

import React, { useState } from "react";
import { useAccount } from "wagmi";
import { ChevronDown, LogOut } from "lucide-react";
import {
  ConnectWallet,
  Wallet,
  WalletDropdown,
  WalletDropdownDisconnect,
} from "@coinbase/onchainkit/wallet";
import { Address, Avatar, Name, Identity } from "@coinbase/onchainkit/identity";
// import { color } from "@coinbase/onchainkit/theme";
import { useStellarWallet } from "@/components/StellarWalletProvider";

/**
 * Supported chains
 */
type Chain = "base" | "stellar";

/**
 * Format wallet address for display
 * Shows first 6 and last 4 characters
 */
function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * WalletConnectButton Component
 *
 * Single button that handles:
 * - Chain selection (Base/Stellar)
 * - Wallet connection for selected chain
 * - Display of connected address
 * - Disconnect functionality
 */
export function WalletConnectButton() {
  const [selectedChain, setSelectedChain] = useState<Chain>("base");
  const [isChainMenuOpen, setIsChainMenuOpen] = useState(false);
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);

  // Base wallet (via OnchainKit/Wagmi)
  const { address: baseAddress, isConnected: isBaseConnected } = useAccount();

  // Stellar wallet (Freighter)
  const {
    publicKey: stellarAddress,
    isConnected: isStellarConnected,
    isFreighterInstalled,
    connect: connectStellar,
    disconnect: disconnectStellar,
    isConnecting: isStellarConnecting,
  } = useStellarWallet();

  /**
   * Get current wallet info based on selected chain
   */
  const getCurrentWallet = () => {
    if (selectedChain === "stellar") {
      return {
        isConnected: isStellarConnected,
        address: stellarAddress,
        chainName: "Stellar",
        chainEmoji: "⭐",
      };
    }
    return {
      isConnected: isBaseConnected,
      address: baseAddress,
      chainName: "Base",
      chainEmoji: "🔵",
    };
  };

  const wallet = getCurrentWallet();

  /**
   * Handle Stellar wallet connection
   */
  const handleStellarConnect = async () => {
    try {
      await connectStellar();
    } catch (error) {
      console.error("Failed to connect Stellar wallet:", error);

      if (!isFreighterInstalled) {
        alert(
          "Freighter wallet is not installed.\n\nPlease install it from:\nhttps://www.freighter.app/",
        );
      } else {
        alert("Failed to connect wallet. Please try again.");
      }
    }
  };

  /**
   * Handle Stellar wallet disconnection
   */
  const handleStellarDisconnect = () => {
    disconnectStellar();
    setIsWalletMenuOpen(false);
  };

  /**
   * Handle chain switching
   */
  const handleChainSwitch = (chain: Chain) => {
    setSelectedChain(chain);
    setIsChainMenuOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Chain Selector Dropdown */}
      <div className="relative">
        <button
          onClick={() => setIsChainMenuOpen(!isChainMenuOpen)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary/50 hover:bg-secondary border border-border transition-colors"
          aria-label="Select blockchain"
        >
          <span className="text-sm">{wallet.chainEmoji}</span>
          <span className="text-xs font-medium hidden sm:inline">
            {wallet.chainName}
          </span>
          <ChevronDown
            className={`h-3 w-3 transition-transform ${isChainMenuOpen ? "rotate-180" : ""}`}
          />
        </button>

        {/* Chain Dropdown Menu */}
        {isChainMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsChainMenuOpen(false)}
            />
            <div className="absolute top-full mt-2 right-0 w-36 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
              <button
                onClick={() => handleChainSwitch("base")}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                  selectedChain === "base"
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-secondary/50"
                }`}
              >
                <span>🔵</span>
                <span className="text-sm font-medium">Base</span>
                {selectedChain === "base" && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500" />
                )}
              </button>
              <button
                onClick={() => handleChainSwitch("stellar")}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                  selectedChain === "stellar"
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-secondary/50"
                }`}
              >
                <span>⭐</span>
                <span className="text-sm font-medium">Stellar</span>
                {selectedChain === "stellar" && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500" />
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Wallet Connection Component */}
      {selectedChain === "base" ? (
        /* Base Wallet - Using OnchainKit */
        <Wallet>
          <ConnectWallet className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Avatar className="h-6 w-6" />
            <Name />
          </ConnectWallet>
          <WalletDropdown>
            <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
              <Avatar />
              <Name />
              <Address />
            </Identity>
            <WalletDropdownDisconnect />
          </WalletDropdown>
        </Wallet>
      ) : /* Stellar Wallet - Custom Implementation */
      isStellarConnected ? (
        /* Connected State - Show Address with Dropdown */
        <div className="relative">
          <button
            onClick={() => setIsWalletMenuOpen(!isWalletMenuOpen)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 border border-border transition-colors"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium font-mono">
              {stellarAddress && formatAddress(stellarAddress)}
            </span>
            <ChevronDown
              className={`h-3 w-3 transition-transform ${isWalletMenuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {/* Wallet Dropdown Menu */}
          {isWalletMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsWalletMenuOpen(false)}
              />
              <div className="absolute top-full mt-2 right-0 w-48 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                {/* Copy Address */}
                <button
                  onClick={() => {
                    if (stellarAddress) {
                      navigator.clipboard.writeText(stellarAddress);
                      alert("Address copied to clipboard!");
                      setIsWalletMenuOpen(false);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/50 transition-colors"
                >
                  <span className="text-sm">📋</span>
                  <div>
                    <div className="text-sm font-medium">Copy Address</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {stellarAddress && formatAddress(stellarAddress)}
                    </div>
                  </div>
                </button>

                {/* Disconnect */}
                <button
                  onClick={handleStellarDisconnect}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-destructive/10 text-destructive transition-colors border-t border-border"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="text-sm font-medium">Disconnect</span>
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        /* Disconnected State - Show Connect Button */
        <button
          onClick={handleStellarConnect}
          disabled={isStellarConnecting}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isStellarConnecting ? "Connecting..." : "Connect Wallet"}
        </button>
      )}

      {/* Freighter Not Installed Warning (Stellar Only) */}
      {selectedChain === "stellar" &&
        !isFreighterInstalled &&
        !isStellarConnected && (
          <div className="fixed bottom-4 right-4 max-w-sm p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg shadow-lg z-50">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400 mb-1">
                  Freighter wallet not detected
                </p>
                <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 mb-2">
                  Install the Freighter extension to connect to Stellar
                </p>
                <a
                  href="https://www.freighter.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 dark:text-yellow-300 underline hover:no-underline"
                >
                  Install Freighter →
                </a>
              </div>
              <button
                onClick={() => setSelectedChain("base")}
                className="text-yellow-600/50 hover:text-yellow-600 dark:text-yellow-400/50 dark:hover:text-yellow-400"
              >
                ✕
              </button>
            </div>
          </div>
        )}
    </div>
  );
}
