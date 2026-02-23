"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useWriteContract, usePublicClient, useAccount } from 'wagmi';
import { parseEther, stringToHex } from 'viem';
import { CallRegistryABI, ERC20ABI } from '../lib/abis';
import { useChain } from './ChainProvider';
import { useStellarWallet } from './StellarWalletProvider';

export interface Call {
  id: string; // callOnchainId
  title: string;
  thesis: string;
  asset: string;
  target: string;
  deadline: string;
  stake: string;
  creator: User;
  status: string;
  createdAt: string;
  backers: number;
  comments: number;
  volume: string;
  totalStakeYes: number;
  totalStakeNo: number;
  stakeToken: string;
  endTs: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conditionJson?: any;
  chain?: "base" | "stellar";
}

export interface User {
  wallet: string;
  displayName?: string;
  handle?: string;
  bio?: string;
  avatarCid?: string;
  avatar?: string; // Legacy UI
}

interface GlobalStateContextType {
  calls: Call[];
  createCall: (call: Omit<Call, 'id' | 'creator' | 'status' | 'createdAt' | 'backers' | 'comments' | 'volume' | 'totalStakeYes' | 'totalStakeNo' | 'stakeToken' | 'endTs' | 'conditionJson'>) => Promise<void>;
  stakeOnCall: (callId: string, amount: number, type: 'back' | 'challenge') => Promise<void>;
  currentUser: User | null;
  isLoading: boolean;
  login: () => Promise<void>;
  updateProfile: (data: { handle: string; bio: string }) => Promise<void>;
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

export function GlobalStateProvider({ children }: { children: React.ReactNode }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();

  const { selectedChain } = useChain();
  const { publicKey: stellarAddress, isConnected: isStellarConnected } = useStellarWallet();

  const address = selectedChain === 'stellar' ? stellarAddress : evmAddress;
  const isConnected = selectedChain === 'stellar' ? isStellarConnected : isEvmConnected;

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
        }),
      });
      if (res.ok) {
        const user = await res.json();
        setCurrentUser(user);
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

  const createCall = async (newCallData: Omit<Call, 'id' | 'creator' | 'status' | 'createdAt' | 'backers' | 'comments' | 'volume' | 'totalStakeYes' | 'totalStakeNo' | 'stakeToken' | 'endTs' | 'conditionJson'>) => {
    if (!currentUser) {
      alert("Please connect wallet first");
      return;
    }
    setIsLoading(true);
    try {
      if (selectedChain === 'stellar') {
        alert("Stellar call creation not implemented yet");
        return;
      }

      const stakeAmount = parseEther(newCallData.stake.split(" ")[0]);
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
      const approveTx = await writeContractAsync({
        address: tokenAddress,
        abi: ERC20ABI,
        functionName: "approve",
        args: [registryAddress, stakeAmount],
      });
      await publicClient?.waitForTransactionReceipt({ hash: approveTx });

      // 3. Create Call
      const deadlineTimestamp = Math.floor(new Date(newCallData.deadline).getTime() / 1000);
      const createTx = await writeContractAsync({
        address: registryAddress,
        abi: CallRegistryABI,
        functionName: "createCall",
        args: [
          tokenAddress,
          stakeAmount,
          BigInt(deadlineTimestamp),
          tokenAddress,
          stringToHex(newCallData.asset, { size: 32 }),
          cid,
        ],
      });
      await publicClient?.waitForTransactionReceipt({ hash: createTx });

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
        totalStakeYes: parseFloat(newCallData.stake.split(" ")[0]) || 0,
        totalStakeNo: 0,
        stakeToken: process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS || "USDC",
        endTs: new Date(newCallData.deadline).toISOString(),
      };
      setCalls((prev) => [newCall, ...prev]);

      setTimeout(fetchCalls, 8000);
    } catch (error) {
      console.error("Failed to create call:", error);
      alert("Failed to create call. See console for details.");
    } finally {
      setIsLoading(false);
    }
  };

  const stakeOnCall = async (callId: string, amount: number, type: "back" | "challenge") => {
    setIsLoading(true);
    try {
      if (selectedChain === 'stellar') {
        alert("Stellar staking not implemented yet");
        return;
      }

      const stakeAmount = parseEther(amount.toString());
      const tokenAddress = process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS as `0x${string}`;
      const registryAddress = process.env.NEXT_PUBLIC_CALL_REGISTRY_ADDRESS as `0x${string}`;

      const approveTx = await writeContractAsync({
        address: tokenAddress,
        abi: ERC20ABI,
        functionName: "approve",
        args: [registryAddress, stakeAmount],
      });
      await publicClient?.waitForTransactionReceipt({ hash: approveTx });

      const position = type === "back";
      const stakeTx = await writeContractAsync({
        address: registryAddress,
        abi: CallRegistryABI,
        functionName: "stakeOnCall",
        args: [BigInt(callId), stakeAmount, position],
      });
      await publicClient?.waitForTransactionReceipt({ hash: stakeTx });

      setCalls((prev) =>
        prev.map((call) => {
          if (call.id === callId) {
            const currentVolume = parseFloat(call.volume.replace(/[^0-9.-]+/g, "")) || 0;
            const newVolume = currentVolume + amount;
            return {
              ...call,
              backers: call.backers + 1,
              volume: `$${newVolume.toLocaleString()}`,
            };
          }
          return call;
        }),
      );
    } catch (error) {
      console.error("Failed to stake:", error);
      alert("Failed to stake. See console for details.");
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
        login,
        updateProfile,
      }}
    >
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
