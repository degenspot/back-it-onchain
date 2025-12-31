"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useWriteContract, usePublicClient, useAccount } from 'wagmi';
import { parseEther, stringToHex } from 'viem';
import { CallRegistryABI, ERC20ABI } from '../lib/abis';

export interface Call {
    id: string;
    title: string;
    thesis: string;
    asset: string;
    target: string;
    deadline: string;
    stake: string;
    creator: User;
    status: 'active' | 'closed' | 'disputed';
    createdAt: string;
    backers: number;
    comments: number;
    volume: string;
}

export interface User {
    wallet: string;
    name?: string;
    handle?: string;
    bio?: string;
    avatar?: string;
}

interface GlobalStateContextType {
    calls: Call[];
    createCall: (call: Omit<Call, 'id' | 'creator' | 'status' | 'createdAt' | 'backers' | 'comments' | 'volume'>) => Promise<void>;
    stakeOnCall: (callId: string, amount: number, type: 'back' | 'challenge') => Promise<void>;
    currentUser: User | null;
    isLoading: boolean;
    login: () => Promise<void>;
    updateProfile: (data: { handle: string; bio: string }) => Promise<void>;
}

const GlobalStateContext = createContext<GlobalStateContextType | undefined>(undefined);

const INITIAL_CALLS: Call[] = [
    // ... (keep initial calls as is, but update creator type if needed, or just cast for now)
    {
        id: "1",
        title: "ETH to hit $4,000 by end of Q2",
        thesis: "The ETF inflows are just starting to ramp up. Technicals showing a clear breakout from the accumulation zone. Supply shock incoming.",
        asset: "ETH",
        target: "$4,000",
        deadline: "Jun 30, 2025",
        stake: "5.0 ETH",
        creator: { wallet: "0x1", name: "CryptoWhale", handle: "@whale_eth", avatar: "bg-blue-500" },
        status: "active",
        createdAt: "2h ago",
        backers: 24,
        comments: 48,
        volume: "$12,450"
    },
    {
        id: "2",
        title: "Base to flip Arbitrum in TVL",
        thesis: "Coinbase Smart Wallet is a game changer. Onboarding millions of users directly to Base. The flippening is inevitable.",
        asset: "TVL",
        target: "Flippening",
        deadline: "Dec 31, 2025",
        stake: "1000 USDC",
        creator: { wallet: "0x2", name: "BaseGod", handle: "@based", avatar: "bg-blue-600" },
        status: "active",
        createdAt: "5h ago",
        backers: 156,
        comments: 89,
        volume: "$45,200"
    },
    {
        id: "3",
        title: "Farcaster to reach 1M DAU",
        thesis: "Network effects are kicking in. Frames are the new mini-apps. It's the only crypto social app that feels like a real product.",
        asset: "DAU",
        target: "1,000,000",
        deadline: "Aug 15, 2025",
        stake: "500 USDC",
        creator: { wallet: "0x3", name: "VitalikFan", handle: "@vitalik_fan", avatar: "bg-green-500" },
        status: "active",
        createdAt: "1d ago",
        backers: 42,
        comments: 12,
        volume: "$8,500"
    }
];

export function GlobalStateProvider({ children }: { children: React.ReactNode }) {
    const [calls, setCalls] = useState<Call[]>(INITIAL_CALLS);
    const [isLoading, setIsLoading] = useState(false);
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    const { writeContractAsync } = useWriteContract();
    const publicClient = usePublicClient();
    const { address, isConnected } = useAccount();

    const login = async () => {
        if (!address) return;
        setIsLoading(true);
        try {
            const res = await fetch('http://localhost:3001/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet: address }),
            });
            const user = await res.json();
            setCurrentUser(user);
        } catch (error) {
            console.error("Login failed:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const updateProfile = async (data: { handle: string; bio: string }) => {
        if (!currentUser || !address) return;
        setIsLoading(true);
        try {
            const res = await fetch(`http://localhost:3001/users/${address}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error('Failed to update profile');
            const updatedUser = await res.json();
            setCurrentUser(updatedUser);
        } catch (error) {
            console.error("Update profile failed:", error);
            alert("Failed to update profile. Handle might be taken.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isConnected && address) {
            login();
        }
    }, [isConnected, address]);

    const createCall = async (newCallData: Omit<Call, 'id' | 'creator' | 'status' | 'createdAt' | 'backers' | 'comments' | 'volume'>) => {
        if (!currentUser) {
            alert("Please connect wallet first");
            return;
        }
        setIsLoading(true);
        try {
            const stakeAmount = parseEther(newCallData.stake.split(' ')[0]); // Assuming "100 USDC" format
            const tokenAddress = process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS as `0x${string}`;
            const registryAddress = process.env.NEXT_PUBLIC_CALL_REGISTRY_ADDRESS as `0x${string}`;

            // 1. Approve Token
            console.log("Approving token...");
            const approveTx = await writeContractAsync({
                address: tokenAddress,
                abi: ERC20ABI,
                functionName: 'approve',
                args: [registryAddress, stakeAmount],
            });
            console.log("Approve Tx:", approveTx);
            // Wait for approval receipt
            await publicClient?.waitForTransactionReceipt({ hash: approveTx });

            // 2. Create Call
            console.log("Creating call...");
            const deadlineTimestamp = Math.floor(new Date(newCallData.deadline).getTime() / 1000);
            const createTx = await writeContractAsync({
                address: registryAddress,
                abi: CallRegistryABI,
                functionName: 'createCall',
                args: [
                    tokenAddress, // _stakeToken
                    stakeAmount,  // _stakeAmount
                    BigInt(deadlineTimestamp), // _endTs
                    tokenAddress, // _tokenAddress (Asset being predicted - using same token for now)
                    stringToHex(newCallData.asset, { size: 32 }), // _pairId (Mocking with asset name)
                    "QmMockCID" // _ipfsCID (Mocking IPFS)
                ],
            });
            console.log("Create Call Tx:", createTx);
            await publicClient?.waitForTransactionReceipt({ hash: createTx });

            // Optimistic Update (or fetch from backend later)
            const newCall: Call = {
                ...newCallData,
                id: Math.random().toString(36).substr(2, 9),
                creator: currentUser,
                status: 'active',
                createdAt: 'Just now',
                backers: 0,
                comments: 0,
                volume: `$${newCallData.stake}`
            };
            setCalls(prev => [newCall, ...prev]);

        } catch (error) {
            console.error("Failed to create call:", error);
            alert("Failed to create call. See console for details.");
        } finally {
            setIsLoading(false);
        }
    };

    const stakeOnCall = async (callId: string, amount: number, type: 'back' | 'challenge') => {
        setIsLoading(true);
        try {
            const stakeAmount = parseEther(amount.toString());
            const tokenAddress = process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS as `0x${string}`;
            const registryAddress = process.env.NEXT_PUBLIC_CALL_REGISTRY_ADDRESS as `0x${string}`;

            // 1. Approve Token
            const approveTx = await writeContractAsync({
                address: tokenAddress,
                abi: ERC20ABI,
                functionName: 'approve',
                args: [registryAddress, stakeAmount],
            });
            await publicClient?.waitForTransactionReceipt({ hash: approveTx });

            // 2. Stake
            const position = type === 'back'; // true for YES (Back), false for NO (Challenge)
            const stakeTx = await writeContractAsync({
                address: registryAddress,
                abi: CallRegistryABI,
                functionName: 'stakeOnCall',
                args: [BigInt(callId), stakeAmount, position],
            });
            await publicClient?.waitForTransactionReceipt({ hash: stakeTx });

            setCalls(prev => prev.map(call => {
                if (call.id === callId) {
                    const currentVolume = parseFloat(call.volume.replace(/[^0-9.-]+/g, "")) || 0;
                    const newVolume = currentVolume + amount;
                    return {
                        ...call,
                        backers: call.backers + 1,
                        volume: `$${newVolume.toLocaleString()}`
                    };
                }
                return call;
            }));

        } catch (error) {
            console.error("Failed to stake:", error);
            alert("Failed to stake. See console for details.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <GlobalStateContext.Provider value={{ calls, createCall, stakeOnCall, currentUser, isLoading, login, updateProfile }}>
            {children}
        </GlobalStateContext.Provider>
    );
}

export function useGlobalState() {
    const context = useContext(GlobalStateContext);
    if (context === undefined) {
        throw new Error('useGlobalState must be used within a GlobalStateProvider');
    }
    return context;
}
