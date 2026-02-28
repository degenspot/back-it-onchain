"use client";

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useGlobalState } from "@/components/GlobalState";

import { CallCard } from "@/components/CallCard";

// Define the Call interface
interface Call {
    id: string;
    title: string;
    thesis: string;
    asset: string;
    target: string;
    deadline: string;
    stake: string;
    creator: { wallet: string; handle: string; } | string;
    status: string;
    createdAt: string;
    backers: number;
    comments: number;
    volume: string;
    totalStakeYes: number;
    totalStakeNo: number;
    stakeToken: string;
    endTs: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conditionJson?: any;
    creatorWallet?: string; // Add creatorWallet if it's part of the raw data
    pairId?: string; // Add pairId if it's part of the raw data
    callOnchainId?: string; // Add callOnchainId if it's part of the raw data
}

const API_BASE_URL = (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

export default function FeedPage() {
    const { currentUser } = useGlobalState();
    const [activeTab, setActiveTab] = useState<'for-you' | 'following'>('for-you');
    const [calls, setCalls] = useState<Call[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const fetchFeed = async () => {
            setIsLoading(true);
            try {
                let url = `${API_BASE_URL}/feed/for-you`;
                if (activeTab === 'following') {
                    if (!currentUser) {
                        setCalls([]);
                        setIsLoading(false);
                        return;
                    }
                    url = `${API_BASE_URL}/feed/following?wallet=${currentUser.wallet}`;
                }

                const res = await fetch(url);
                if (!res.ok) throw new Error('Failed to fetch feed');
                const data = await res.json();

                // Map backend calls to frontend format
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mappedCalls: Call[] = data.map((c: any) => ({
                    id: c.callOnchainId || c.id.toString(),
                    title: c.conditionJson?.title || "Call #" + (c.callOnchainId || c.id),
                    thesis: c.conditionJson?.thesis || "Thesis for " + (c.pairId || "this call"),
                    asset: c.pairId ? Buffer.from(c.pairId.replace('0x', ''), 'hex').toString().replace(/\0/g, '') : "Unknown",
                    target: c.conditionJson?.target || "TBD",
                    deadline: new Date(c.endTs).toLocaleDateString(),
                    stake: `${c.totalStakeYes || 0} ${c.stakeToken || 'USDC'}`,
                    creator: c.creator || { wallet: c.creatorWallet, handle: c.creatorWallet?.slice(0, 6) },
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
                console.error("Feed fetch error:", error);
                setCalls([]);
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

// function Badge({ icon, label, color }: { icon: React.ReactNode, label: string, color: 'primary' | 'secondary' | 'accent' }) {
//     const colors = {
//         primary: "bg-primary/10 text-primary border-primary/20",
//         secondary: "bg-secondary text-muted-foreground border-border",
//         accent: "bg-accent/10 text-accent border-accent/20",
//     };

//     return (
//         <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border", colors[color])}>
//             {icon}
//             {label}
//         </div>
//     );
// }
