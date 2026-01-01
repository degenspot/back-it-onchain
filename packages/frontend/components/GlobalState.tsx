"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useWriteContract, usePublicClient, useAccount } from 'wagmi';
import { parseEther, stringToHex } from 'viem';
import { CallRegistryABI, ERC20ABI } from '../lib/abis';

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
    conditionJson?: any;
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
    createCall: (call: Omit<Call, 'id' | 'creator' | 'status' | 'createdAt' | 'backers' | 'comments' | 'volume'>) => Promise<void>;
    stakeOnCall: (callId: string, amount: number, type: 'back' | 'challenge') => Promise<void>;
    currentUser: User | null;
    isLoading: boolean;
    login: () => Promise<void>;
    updateProfile: (data: { handle: string; bio: string }) => Promise<void>;
}

const GlobalStateContext = createContext<GlobalStateContextType | undefined>(undefined);

const INITIAL_CALLS: Call[] = [];

export function GlobalStateProvider({ children }: { children: React.ReactNode }) {
    const [calls, setCalls] = useState<Call[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    const { writeContractAsync } = useWriteContract();
    const publicClient = usePublicClient();
    const { address, isConnected } = useAccount();

    const fetchCalls = async () => {
        try {
            const res = await fetch('http://localhost:3001/calls');
            if (!res.ok) throw new Error('Failed to fetch calls');
            const data = await res.json();

            // Map backend calls to frontend format
            const mappedCalls: Call[] = data.map((c: any) => ({
                id: c.callOnchainId || c.id.toString(),
                title: c.conditionJson?.title || "Call #" + (c.callOnchainId || c.id),
                thesis: c.conditionJson?.thesis || "Thesis for " + (c.pairId || "this call"),
                asset: c.pairId ? Buffer.from(c.pairId.replace('0x', ''), 'hex').toString().replace(/\0/g, '') : "Unknown",
                target: c.conditionJson?.target || "TBD",
                deadline: new Date(c.endTs).toLocaleDateString(),
                stake: `${c.totalStakeYes} ${c.stakeToken}`,
                creator: c.creator || { wallet: c.creatorWallet, handle: c.creatorWallet.slice(0, 6) },
                status: c.status || 'active',
                createdAt: c.createdAt,
                backers: 0,
                comments: 0,
                volume: `$${(Number(c.totalStakeYes || 0) + Number(c.totalStakeNo || 0)).toLocaleString()}`,
                totalStakeYes: Number(c.totalStakeYes || 0),
                totalStakeNo: Number(c.totalStakeNo || 0),
                stakeToken: c.stakeToken || 'USDC',
                endTs: c.endTs,
                conditionJson: c.conditionJson
            }));

            setCalls(mappedCalls);
        } catch (error) {
            console.error("Failed to fetch calls:", error);
        }
    };

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
        fetchCalls();
    }, []);

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

            // 1. Upload Metadata to Mock IPFS
            const metadata = {
                title: newCallData.title,
                thesis: newCallData.thesis,
                asset: newCallData.asset,
                target: newCallData.target,
                deadline: newCallData.deadline
            };

            const ipfsRes = await fetch('http://localhost:3001/calls/ipfs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(metadata)
            });
            const { cid } = await ipfsRes.json();
            console.log("Uploaded metadata, CID:", cid);

            // 2. Approve Token
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

            // 3. Create Call
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
                    cid // _ipfsCID (Mocking IPFS)
                ],
            });
            console.log("Create Call Tx:", createTx);
            await publicClient?.waitForTransactionReceipt({ hash: createTx });

            // Optimistic Update
            const newCall: Call = {
                id: 'optimistic-' + Math.random().toString(36).substr(2, 9),
                title: newCallData.title,
                thesis: newCallData.thesis,
                asset: newCallData.asset,
                target: newCallData.target,
                deadline: newCallData.deadline,
                stake: newCallData.stake,
                creator: currentUser,
                status: 'active',
                createdAt: new Date().toISOString(),
                backers: 1,
                comments: 0,
                volume: `$${newCallData.stake}`,
                totalStakeYes: parseFloat(newCallData.stake.split(' ')[0]) || 0,
                totalStakeNo: 0,
                stakeToken: process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS || 'USDC',
                endTs: new Date(newCallData.deadline).toISOString()
            };
            setCalls(prev => [newCall, ...prev]);

            // Refresh calls from backend after some delay for indexer
            setTimeout(fetchCalls, 8000); // Increased to 8s for local anvil indexing + backend processing

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
