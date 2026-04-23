"use client";

import { useState, useEffect } from 'react';
import { CallCard } from '@/components/CallCard';
import { CallCardSkeleton } from '@/components/CallCardSkeleton';

export interface Call {
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

interface FeedListProps {
    initialCalls?: Call[];
    fetchUrl?: string;
}

export function FeedList({ initialCalls = [], fetchUrl = '/calls' }: FeedListProps) {
    const [calls, setCalls] = useState<Call[]>(initialCalls);
    const [loading, setLoading] = useState(initialCalls.length === 0);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (initialCalls.length > 0) return;

        const fetchCalls = async () => {
            setLoading(true);
            try {
                const response = await fetch(fetchUrl);
                if (response.ok) {
                    const data = await response.json();
                    setCalls(data);
                } else {
                    setError('Failed to fetch calls');
                }
            } catch (err) {
                setError('An error occurred');
            } finally {
                setLoading(false);
            }
        };
        fetchCalls();
    }, [fetchUrl, initialCalls.length]);

    if (loading) {
        return (
            <div className="space-y-4" data-testid="feed-loading">
                {Array.from({ length: 3 }).map((_, i) => (
                    <CallCardSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (error && calls.length === 0) {
        return (
            <div className="text-center py-8 text-red-500" data-testid="feed-error">
                {error}
            </div>
        );
    }

    if (calls.length === 0) {
        return (
            <div className="text-center py-8 text-muted-foreground" data-testid="feed-empty">
                No calls found.
            </div>
        );
    }

    return (
        <div className="space-y-4" data-testid="feed-list">
            {calls.map((call) => (
                <CallCard key={call.id} call={call} />
            ))}
        </div>
    );
}
