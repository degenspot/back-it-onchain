"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { TrendingUp, Clock, ShieldCheck, MessageSquare, ArrowUpRight } from 'lucide-react';
import { useGlobalState } from "@/components/GlobalState";

import { CallCard } from "@/components/CallCard";

export default function FeedPage() {
    const { currentUser } = useGlobalState();
    const [activeTab, setActiveTab] = useState<'for-you' | 'following'>('for-you');
    const [calls, setCalls] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const fetchFeed = async () => {
            setIsLoading(true);
            try {
                let url = 'http://localhost:3001/feed/for-you';
                if (activeTab === 'following') {
                    if (!currentUser) {
                        setCalls([]);
                        setIsLoading(false);
                        return;
                    }
                    url = `http://localhost:3001/feed/following?wallet=${currentUser.wallet}`;
                }

                const res = await fetch(url);
                if (!res.ok) throw new Error('Failed to fetch feed');
                const data = await res.json();
                setCalls(data);
            } catch (error) {
                console.error("Feed fetch error:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchFeed();
    }, [activeTab, currentUser]);

    const RightSidebar = (
        <div className="space-y-6">
            <div className="bg-secondary/20 rounded-xl p-6 border border-border">
                <h3 className="font-bold text-lg mb-2">Trending Markets</h3>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-medium text-sm">ETH &gt; $4k</p>
                            <p className="text-xs text-muted-foreground">Vol: $1.2M</p>
                        </div>
                        <div className="text-green-500 font-bold text-sm">+12%</div>
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-medium text-sm">Base TVL &gt; Arb</p>
                            <p className="text-xs text-muted-foreground">Vol: $850k</p>
                        </div>
                        <div className="text-green-500 font-bold text-sm">+5%</div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <AppLayout rightSidebar={RightSidebar}>
            <div className="p-4">
                {/* Tabs */}
                <div className="flex gap-6 mb-6 border-b border-border px-2">
                    <button
                        onClick={() => setActiveTab('for-you')}
                        className={`pb-3 border-b-2 font-bold transition-colors ${activeTab === 'for-you' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                    >
                        For You
                    </button>
                    <button
                        onClick={() => setActiveTab('following')}
                        className={`pb-3 border-b-2 font-bold transition-colors ${activeTab === 'following' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                    >
                        Following
                    </button>
                </div>

                {/* Feed */}
                <div className="space-y-4">
                    {isLoading ? (
                        <div className="text-center py-10 text-muted-foreground">Loading feed...</div>
                    ) : calls.length > 0 ? (
                        calls.map((call) => (
                            <CallCard key={call.id} call={call} />
                        ))
                    ) : (
                        <div className="text-center py-10 text-muted-foreground">
                            {activeTab === 'following' ? "Follow users to see their calls here." : "No calls found."}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}

function Badge({ icon, label }: { icon: React.ReactNode, label: string }) {
    return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/50 text-xs font-medium text-muted-foreground border border-border">
            {icon}
            {label}
        </div>
    );
}
