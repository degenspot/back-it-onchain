"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useWriteContract, usePublicClient, useAccount, useChainId } from 'wagmi';
import { parseEther, stringToHex, type Hash } from 'viem';
import { CallRegistryABI, ERC20ABI } from '../lib/abis';
import { useChain } from './ChainProvider';
import { useStellarWallet } from './StellarWalletProvider';
import {
  showTxConfirmedToast,
  showTxFailedToast,
  showTxSubmittedToast,
  showWarningToast,
  showInfoToast,
} from './tx-toast';
import { useSocket, type SocketCallEvent } from '../hooks/useSocket';
import { type Call, type User } from '../lib/types';

type StakingStep =
  | "idle"
  | "approving"
  | "approved"
  | "staking"
  | "confirmed";

interface GlobalStateContextType {
  calls: Call[];
  createCall: (call: Omit<Call, 'id' | 'creator' | 'status' | 'createdAt' | 'backers' | 'comments' | 'volume' | 'totalStakeYes' | 'totalStakeNo' | 'stakeToken' | 'endTs' | 'conditionJson'>) => Promise<void>;
  stakeOnCall: (callId: string, amount: number, type: 'back' | 'challenge') => Promise<void>;
  currentUser: User | null;
  isLoading: boolean;
  stakingStep: StakingStep;
  login: () => Promise<void>;
  setPendingReferrerWallet: (referrerWallet: string | null) => void;
  updateProfile: (data: { handle: string; bio: string }) => Promise<void>;
  newCallsBanner: boolean;
  dismissNewCallsBanner: () => void;
}

const GlobalStateContext = createContext<GlobalStateContextType | undefined>(
  undefined,
);

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

const isNetworkError = (error: unknown): boolean =>
  error instanceof TypeError && (error as Error).message === "Failed to fetch";

const isUserRejectedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("denied transaction signature") ||
    message.includes("rejected the request") ||
    message.includes("cancelled")
  );
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return "Something went wrong while processing this transaction.";
};

export function GlobalStateProvider({ children }: { children: React.ReactNode }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [stakingStep, setStakingStep] = useState<StakingStep>("idle");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [newCallsBanner, setNewCallsBanner] = useState(false);
  const [pendingReferrerWallet, setPendingReferrerWallet] = useState<
    string | null
  >(null);

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();

  const { selectedChain } = useChain();
  const { publicKey: stellarAddress, isConnected: isStellarConnected } = useStellarWallet();

  const address = selectedChain === 'stellar' ? stellarAddress : evmAddress;
  const isConnected = selectedChain === 'stellar' ? isStellarConnected : isEvmConnected;

  const dismissNewCallsBanner = useCallback(() => setNewCallsBanner(false), []);

  const mergeCall = useCallback((incoming: Call) => {
    setCalls((prev) => {
      const exists = prev.some((c) => c.id === incoming.id);
      if (exists) return prev.map((c) => (c.id === incoming.id ? { ...c, ...incoming } : c));
      setNewCallsBanner(true);
      return [incoming, ...prev];
    });
  }, []);

  useSocket({
    onCallCreated: useCallback((data: SocketCallEvent) => {
      const call: Call = {
        id: data.callOnchainId ?? data.id ?? String(Math.random()),
        title: data.conditionJson?.title ?? `Call #${data.callOnchainId ?? data.id}`,
        thesis: data.conditionJson?.thesis ?? "",
        asset: data.asset ?? "",
        target: data.conditionJson?.target ?? "",
        deadline: data.endTs ? new Date(data.endTs).toLocaleDateString() : "",
        stake: `${data.totalStakeYes ?? 0} ${data.stakeToken ?? "USDC"}`,
        creator: data.creator ?? { wallet: data.creatorWallet ?? "" },
        status: data.status ?? "active",
        createdAt: data.createdAt ?? new Date().toISOString(),
        backers: 0,
        comments: 0,
        volume: `$${Number(data.totalStakeYes ?? 0) + Number(data.totalStakeNo ?? 0)}`,
        totalStakeYes: Number(data.totalStakeYes ?? 0),
        totalStakeNo: Number(data.totalStakeNo ?? 0),
        stakeToken: data.stakeToken ?? "USDC",
        endTs: data.endTs ?? "",
        conditionJson: data.conditionJson,
        chain: data.chain,
      };
      mergeCall(call);
    }, [mergeCall]),
    onStakeAdded: useCallback((data: SocketCallEvent) => {
      setCalls((prev) =>
        prev.map((c) =>
          c.id === (data.callOnchainId ?? data.id)
            ? {
              ...c,
              totalStakeYes: Number(data.totalStakeYes ?? c.totalStakeYes),
              totalStakeNo: Number(data.totalStakeNo ?? c.totalStakeNo),
              backers: (c.backers || 0) + 1,
            }
            : c,
        ),
      );
    }, []),
    onOutcomeResolved: useCallback((data: SocketCallEvent) => {
      setCalls((prev) =>
        prev.map((c) =>
          c.id === (data.callOnchainId ?? data.id)
            ? { ...c, status: data.status ?? "resolved" }
            : c,
        ),
      );
    }, []),
  });

  const fetchCalls = async () => {
    try {
      const res = await fetch(buildApiUrl("/calls"));
      if (!res.ok) throw new Error("Failed to fetch calls");
      const data = await res.json();

      // map backend data to Call interface
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedCalls: Call[] = data.map((item: any) => ({
        id: item.callOnchainId || item.id,
        ...item
      }));
      setCalls(mappedCalls);
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn(
          "Backend API unreachable at",
          API_BASE_URL,
          "- ensure the backend is running (e.g. pnpm --filter backend dev)"
        );
      } else {
        console.error("Failed to fetch calls:", error);
      }
    }
  };

  const login = async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      const res = await fetch(buildApiUrl("/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          chain: selectedChain,
          referrerWallet: pendingReferrerWallet ?? undefined,
        }),
      });
      if (res.ok) {
        const user = await res.json();
        setCurrentUser(user);
        setPendingReferrerWallet(null);
      }
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn(
          "Backend API unreachable at",
          API_BASE_URL,
          "- ensure the backend is running (e.g. pnpm --filter backend dev)"
        );
      } else {
        console.error("Login failed:", error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const updateProfile = async (data: { handle: string; bio: string }) => {
    if (!address) return;
    setIsLoading(true);
    try {
      const res = await fetch(buildApiUrl(`/users/${encodeURIComponent(address)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const updatedUser = await res.json();
        setCurrentUser(updatedUser);
      } else {
        const err = await res.json();
        throw new Error(err.message || "Failed to update profile");
      }
    } catch (error) {
      console.error("Profile update failed:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected && address) {
      login();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, selectedChain]);

  useEffect(() => {
    fetchCalls();
  }, []);

  const trackEvmTransaction = async (params: {
    submittedTitle: string;
    confirmedTitle: string;
    failedTitle: string;
    write: () => Promise<Hash>;
    onStart?: () => void;
    onConfirmed?: () => void;
  }): Promise<Hash> => {
    let txHash: Hash | undefined;
    try {
      if (!publicClient) {
        throw new Error("Unable to access chain client. Please reconnect wallet.");
      }

      params.onStart?.(); // ✅ NEW

      txHash = await params.write();

      showTxSubmittedToast({
        title: params.submittedTitle,
        description: "Waiting for onchain confirmation.",
        hash: txHash,
        chainId,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error("Transaction was mined but reverted.");
      }

      params.onConfirmed?.(); // ✅ NEW

      showTxConfirmedToast({
        title: params.confirmedTitle,
        description: "Transaction confirmed onchain.",
        hash: txHash,
        chainId,
      });

      return txHash;
    } catch (error) {
      showTxFailedToast({
        title: isUserRejectedError(error) ? "Tx Rejected" : params.failedTitle,
        description: isUserRejectedError(error)
          ? "You rejected this transaction in your wallet."
          : getErrorMessage(error),
        hash: txHash,
        chainId,
      });
      throw error;
    }
  };

  const createCall = async (newCallData: Omit<Call, 'id' | 'creator' | 'status' | 'createdAt' | 'backers' | 'comments' | 'volume' | 'totalStakeYes' | 'totalStakeNo' | 'stakeToken' | 'endTs' | 'conditionJson'>) => {
    if (!currentUser) {
      showWarningToast({ title: "Wallet not connected", description: "Please connect your wallet first." });
      return;
    }
    setIsLoading(true);
    try {
      if (selectedChain === 'stellar') {
        showInfoToast({ title: "Coming soon", description: "Stellar call creation is not implemented yet." });
        return;
      }

      const stakeAmount = parseEther((newCallData.stake || "").split(" ")[0] || "0");
      const tokenAddress = process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS as `0x${string}`;
      const registryAddress = process.env.NEXT_PUBLIC_CALL_REGISTRY_ADDRESS as `0x${string}`;

      // 1. Upload Metadata to Mock IPFS
      const metadata = {
        title: newCallData.title,
        thesis: newCallData.thesis,
        asset: newCallData.asset,
        target: newCallData.target,
        deadline: newCallData.deadline,
      };

      const ipfsRes = await fetch(buildApiUrl("/calls/ipfs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      });
      const { cid } = await ipfsRes.json();

      // 2. Approve Token
      await trackEvmTransaction({
        submittedTitle: "Tx Submitted: Token approval",
        confirmedTitle: "Tx Confirmed: Token approval",
        failedTitle: "Tx Failed: Token approval",
        write: () =>
          writeContractAsync({
            address: tokenAddress,
            abi: ERC20ABI,
            functionName: "approve",
            args: [registryAddress, stakeAmount],
          }),
      });

      // 3. Create Call
      const deadlineTimestamp = Math.floor(new Date(newCallData.deadline || "").getTime() / 1000);
      await trackEvmTransaction({
        submittedTitle: "Tx Submitted: Create call",
        confirmedTitle: "Tx Confirmed: Create call",
        failedTitle: "Tx Failed: Create call",
        write: () =>
          writeContractAsync({
            address: registryAddress,
            abi: CallRegistryABI,
            functionName: "createCall",
            args: [
              tokenAddress,
              stakeAmount,
              BigInt(deadlineTimestamp),
              tokenAddress,
              stringToHex(newCallData.asset || "", { size: 32 }),
              cid,
            ],
          }),
      });

      // Optimistic Update
      const newCall: Call = {
        id: "optimistic-" + Math.random().toString(36).substr(2, 9),
        title: newCallData.title,
        thesis: newCallData.thesis,
        asset: newCallData.asset,
        target: newCallData.target,
        deadline: newCallData.deadline,
        stake: newCallData.stake,
        creator: currentUser,
        status: "active",
        createdAt: new Date().toISOString(),
        backers: 1,
        comments: 0,
        volume: `$${newCallData.stake}`,
        totalStakeYes: parseFloat((newCallData.stake || "").split(" ")[0]) || 0,
        totalStakeNo: 0,
        stakeToken: process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS || "USDC",
        endTs: new Date(newCallData.deadline || "").toISOString(),
      };
      setCalls((prev) => [newCall, ...prev]);
    } catch (error) {
      console.error("Failed to create call:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const stakeOnCall = async (
    callId: string,
    amount: number,
    type: "back" | "challenge"
  ) => {
    setIsLoading(true);
    setStakingStep("idle");

    try {
      if (selectedChain === 'stellar') {
        showInfoToast({ title: "Coming soon", description: "Stellar staking is not implemented yet." });
        return;
      }

      const stakeAmount = parseEther(amount.toString());
      const tokenAddress = process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS as `0x${string}`;
      const registryAddress = process.env.NEXT_PUBLIC_CALL_REGISTRY_ADDRESS as `0x${string}`;

      // STEP 1: APPROVE
      await trackEvmTransaction({
        submittedTitle: "Tx Submitted: Token approval",
        confirmedTitle: "Tx Confirmed: Token approval",
        failedTitle: "Tx Failed: Token approval",
        onStart: () => setStakingStep("approving"),
        onConfirmed: () => setStakingStep("approved"),
        write: () =>
          writeContractAsync({
            address: tokenAddress,
            abi: ERC20ABI,
            functionName: "approve",
            args: [registryAddress, stakeAmount],
          }),
      });

      // STEP 2: STAKE
      const position = type === "back";

      await trackEvmTransaction({
        submittedTitle: "Tx Submitted: Stake on call",
        confirmedTitle: "Tx Confirmed: Stake on call",
        failedTitle: "Tx Failed: Stake on call",
        onStart: () => setStakingStep("staking"),
        onConfirmed: () => setStakingStep("confirmed"),
        write: () =>
          writeContractAsync({
            address: registryAddress,
            abi: CallRegistryABI,
            functionName: "stakeOnCall",
            args: [BigInt(callId), stakeAmount, position],
          }),
      });

      // Optimistic UI update (unchanged)
      setCalls((prev) =>
        prev.map((call) => {
          if (call.id === callId) {
            const currentVolume =
              parseFloat(String(call.volume || "").replace(/[^0-9.-]+/g, "")) || 0;
            const newVolume = currentVolume + amount;

            return {
              ...call,
              backers: (call.backers || 0) + 1,
              volume: `$${newVolume.toLocaleString()}`,
            };
          }
          return call;
        }),
      );
    } catch (error) {
      console.error("Failed to stake:", error);
      setStakingStep("idle"); // reset on error
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <GlobalStateContext.Provider
      value={{
        calls,
        createCall,
        stakeOnCall,
        currentUser,
        isLoading,
        stakingStep,
        login,
        setPendingReferrerWallet,
        updateProfile,
        newCallsBanner,
        dismissNewCallsBanner,
      }}
    >
      {newCallsBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-lg">
          New calls available
          <button
            onClick={dismissNewCallsBanner}
            className="ml-1 text-primary-foreground/70 hover:text-primary-foreground"
          >
            ✕
          </button>
        </div>
      )}
      {children}
    </GlobalStateContext.Provider>
  );
}

export function useGlobalState() {
  const context = useContext(GlobalStateContext);
  if (context === undefined) {
    throw new Error("useGlobalState must be used within a GlobalStateProvider");
  }
  return context;
}
