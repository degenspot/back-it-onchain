"use client";

import { useState, useEffect } from 'react';
import { CallCard } from './CallCard';
import { CallCardSkeleton } from './CallCardSkeleton';
import StakingModal from './StakingModal';
import RecommendedUsers from './RecommendedUsers';

type ChainFilter = 'all' | 'base' | 'stellar';

interface Call {
    id: number;
    tokenAddress: string;
    stakeAmount: string;
    targetPrice: string;
    endTs: string;
    creatorWallet: string;
    chain: 'base' | 'stellar';
    status?: string;
    stakeToken?: string;
    totalStakeYes?: number;
    totalStakeNo?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conditionJson?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    creator?: any;
    createdAt?: string;
}

export function Feed() {
    const [calls, setCalls] = useState<Call[]>([]);
    const [chainFilter, setChainFilter] = useState<ChainFilter>('all');
    const [tab, setTab] = useState<'for-you' | 'following' | 'newest'>('for-you');
    const [selectedCall, setSelectedCall] = useState<Call | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchCalls = async () => {
            setLoading(true);
            try {
                const params = chainFilter !== 'all' ? `?chain=${chainFilter}` : '';
                const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/calls${params}`);
                if (response.ok) {
                    const data = await response.json();
                    setCalls(data);
                } else {
                    // Fallback to mock data if API fails
                    setCalls([
                        {
                            id: 1,
                            tokenAddress: '0x420...69',
                            stakeAmount: '100',
                            targetPrice: '2000',
                            endTs: new Date(Date.now() + 86400000).toISOString(),
                            creatorWallet: '0x123...abc',
                            chain: 'base',
                            status: 'OPEN',
                            stakeToken: 'USDC',
                        },
                        {
                            id: 2,
                            tokenAddress: 'GBXYZ...789',
                            stakeAmount: '500',
                            targetPrice: '0.50',
                            endTs: new Date(Date.now() + 172800000).toISOString(),
                            creatorWallet: 'GDEF...456',
                            chain: 'stellar',
                            status: 'OPEN',
                            stakeToken: 'USDC',
                        },
                    ]);
                }
            } catch {
                // Fallback to mock data on error
                setCalls([
                    {
                        id: 1,
                        tokenAddress: '0x420...69',
                        stakeAmount: '100',
                        targetPrice: '2000',
                        endTs: new Date(Date.now() + 86400000).toISOString(),
                        creatorWallet: '0x123...abc',
                        chain: 'base',
                        status: 'OPEN',
                        stakeToken: 'USDC',
                    },
                    {
                        id: 2,
                        tokenAddress: 'GBXYZ...789',
                        stakeAmount: '500',
                        targetPrice: '0.50',
                        endTs: new Date(Date.now() + 172800000).toISOString(),
                        creatorWallet: 'GDEF...456',
                        chain: 'stellar',
                        status: 'OPEN',
                        stakeToken: 'USDC',
                    },
                ]);
            } finally {
                setLoading(false);
            }
        };
        fetchCalls();
    }, [chainFilter]);

    useEffect(() => {
        function handler(e: any) {
            setSelectedCall(e.detail);
            setShowModal(true);
        }
        window.addEventListener('quick-stake', handler as EventListener);
        return () => window.removeEventListener('quick-stake', handler as EventListener);
    }, []);

    return (
        <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-2 mb-4">
                <button onClick={() => setTab('for-you')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'for-you' ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80'}`}>For You</button>
                <button onClick={() => setTab('following')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'following' ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80'}`}>Following</button>
                <button onClick={() => setTab('newest')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'newest' ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80'}`}>Newest</button>
            </div>

            {/* Chain Filter Buttons */}
            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => setChainFilter('all')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${chainFilter === 'all'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                        }`}
                >
                    All Chains
                </button>
                <button
                    onClick={() => setChainFilter('base')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${chainFilter === 'base'
                        ? 'bg-blue-500 text-white'
                        : 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border border-blue-500/20'
                        }`}
                >
                    <div className="w-2 h-2 rounded-full bg-current" />
                    Base
                </button>
                <button
                    onClick={() => setChainFilter('stellar')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${chainFilter === 'stellar'
                        ? 'bg-purple-500 text-white'
                        : 'bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 border border-purple-500/20'
                        }`}
                >
                    <div className="w-2 h-2 rounded-full bg-current" />
                    Stellar
                </button>
            </div>

            {/* Loading State - Show skeleton loaders */}
            {loading && (
                <div className="space-y-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <CallCardSkeleton key={i} />
                    ))}
                </div>
            )}

            {/* Calls List */}
            {!loading && calls.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                    No calls found.
                </div>
            )}

            {!loading && (() => {
                let list = calls.slice();
                if (tab === 'following') {
                    list = list.filter(c => c.creator?.isFollowing);
                } else if (tab === 'newest') {
                    list = list.sort((a,b) => (new Date(b.createdAt || '').getTime() || 0) - (new Date(a.createdAt || '').getTime() || 0));
                } else {
                    // for-you: simple algorithmic sort: prioritize base chain
                    list = list.sort((a,b) => (a.chain === 'base' ? -1 : 1));
                }

                if (tab === 'following' && list.length === 0) {
                    return <RecommendedUsers />;
                }

                return list.map((call) => (
                    <CallCard key={call.id} call={call} />
                ));
            })()}

            <StakingModal open={showModal} call={selectedCall} onClose={() => setShowModal(false)} />
        </div>
    );
}
