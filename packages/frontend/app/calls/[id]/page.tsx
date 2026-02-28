"use client";

import { useParams } from "next/navigation";
import { AppLayout } from "@/components/AppLayout";
import { ArrowLeft, TrendingUp, Clock, ShieldCheck, Users, MessageSquare, Share2, Flag, Target, Wallet, BarChart3 } from 'lucide-react';
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useGlobalState } from "@/components/GlobalState";
import { useState, useEffect } from "react";
import { Loader } from "@/components/ui/Loader";
import { PriceChart } from "@/components/PriceChart";
import { ActivityLog } from "@/components/ActivityLog";
import { MarketDetailSkeleton } from "@/components/MarketDetailSkeleton";
import { MarketDetailRightSidebarSkeleton } from "@/components/MarketDetailRightSidebarSkeleton";

export default function CallDetailPage() {
    const params = useParams();
    const id = params?.id as string;
    const { calls, stakeOnCall, isLoading } = useGlobalState();
    const [stakingType, setStakingType] = useState<'back' | 'challenge' | null>(null);
    const [isFetching, setIsFetching] = useState(true);

    const call = calls.find(c => c.id === id);

    // Simulate initial data fetching
    useEffect(() => {
        if (calls.length > 0) {
            // Add a small delay to show skeleton
            const timer = setTimeout(() => {
                setIsFetching(false);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [calls]);

    if (isFetching) {
        return (
            <AppLayout rightSidebar={<MarketDetailRightSidebarSkeleton />}>
                <MarketDetailSkeleton />
            </AppLayout>
        );
    }

    if (!call) {
        return (
            <AppLayout>
                <div className="min-h-[50vh] flex flex-col items-center justify-center text-muted-foreground">
                    <h2 className="text-xl font-bold mb-2">Call not found</h2>
                    <Link href="/feed" className="text-primary hover:underline">Return to Feed</Link>
                </div>
            </AppLayout>
        );
    }

    // Parse stake amount for calculations
    const stakeAmount = parseFloat(call.stake.split(" ")[0]) || 0;
    const startPrice = 0.12; // Mock start price
    const targetPrice = parseFloat(call.target.replace(/[^0-9.]/g, "")) || startPrice * 1.25;

    const RightSidebar = (
        <div className="space-y-6">
            {/* Market Stats */}
            <div className="bg-secondary/20 rounded-xl p-6 border border-border">
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Market Stats
                </h3>
                <div className="space-y-4">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Total Volume</span>
                        <span className="font-bold text-foreground">{call.volume}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Participants</span>
                        <span className="font-bold text-foreground">{call.backers}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Total Staked</span>
                        <span className="font-bold text-green-500">{call.totalStakeYes} USDC</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Challenged</span>
                        <span className="font-bold text-red-500">{call.totalStakeNo} USDC</span>
                    </div>
                    <div className="h-px bg-border my-2" />
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Start Price</span>
                        <span className="font-medium text-foreground">${startPrice.toFixed(6)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Target Price</span>
                        <span className="font-medium text-accent">${targetPrice.toFixed(6)}</span>
                    </div>
                </div>
            </div>

            {/* Creator Info */}
            <div className="bg-secondary/20 rounded-xl p-6 border border-border">
                <h3 className="font-bold text-lg mb-4">About Creator</h3>
                <div className="flex items-center gap-3 mb-4">
                    <div className={`h-12 w-12 rounded-full ${call.creator.avatar || 'bg-primary'} flex items-center justify-center font-bold text-white`}>
                        {(call.creator.displayName || call.creator.wallet.slice(0, 6)).substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <div className="font-bold">{call.creator.displayName || call.creator.wallet.slice(0, 6)}</div>
                        <div className="text-xs text-muted-foreground">{call.creator.handle || '@anonymous'}</div>
                    </div>
                </div>
                <p className="text-sm text-muted-foreground">
                    This creator has made {call.backers} successful predictions with a total volume of {call.volume}.
                </p>
            </div>
        </div>
    );

    return (
        <AppLayout rightSidebar={RightSidebar}>
            {isLoading && <Loader text="Processing Transaction..." />}
            
            {/* Header */}
            <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-4">
                <Link href="/feed" className="p-2 hover:bg-secondary rounded-full transition-colors">
                    <ArrowLeft className="h-5 w-5" />
                </Link>
                <div className="flex-1">
                    <h1 className="text-lg font-bold truncate">{call.asset}/{call.target}</h1>
                    <p className="text-xs text-muted-foreground">Market Detail</p>
                </div>
                <div className="flex items-center gap-2">
                    <button className="p-2 hover:bg-secondary rounded-full transition-colors text-muted-foreground hover:text-foreground">
                        <Share2 className="h-5 w-5" />
                    </button>
                    <button className="p-2 hover:bg-secondary rounded-full transition-colors text-muted-foreground hover:text-foreground">
                        <Flag className="h-5 w-5" />
                    </button>
                </div>
            </header>

            <div className="p-6">
                {/* Price Chart Section */}
                <section className="mb-8">
                    <PriceChart 
                        asset={call.asset} 
                        target={call.target} 
                        startPrice={startPrice}
                        targetPrice={targetPrice}
                    />
                </section>

                {/* Call Header Info */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-4">
                        <div className={`h-10 w-10 rounded-full ${call.creator.avatar || 'bg-primary'} flex items-center justify-center font-bold text-white text-sm`}>
                            {(call.creator.displayName || call.creator.wallet.slice(0, 6)).substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                            <div className="font-bold">{call.creator.displayName || call.creator.wallet.slice(0, 6)}</div>
                            <div className="text-xs text-muted-foreground">{call.creator.handle || '@anonymous'} • {call.createdAt}</div>
                        </div>
                    </div>

                    <h1 className="text-2xl font-bold mb-4 leading-tight">{call.title}</h1>

                    <div className="flex flex-wrap gap-3 mb-6">
                        <Badge icon={<TrendingUp className="h-4 w-4" />} label={`${call.asset} ➜ ${call.target}`} color="primary" />
                        <Badge icon={<ShieldCheck className="h-4 w-4" />} label={`Stake: ${call.stake}`} color="accent" />
                        <Badge icon={<Clock className="h-4 w-4" />} label={`By ${call.deadline}`} color="secondary" />
                    </div>
                </div>

                {/* Thesis Section - Prominent Display */}
                <section className="mb-8">
                    <div className="bg-gradient-to-br from-secondary/50 to-secondary/20 rounded-xl p-6 border border-border">
                        <div className="flex items-center gap-2 mb-4">
                            <Target className="h-5 w-5 text-primary" />
                            <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">Creator&apos;s Thesis</h3>
                        </div>
                        <p className="text-lg leading-relaxed text-foreground">{call.thesis}</p>
                        <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <Wallet className="h-4 w-4" />
                                Stake: {call.stake}
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                Deadline: {call.deadline}
                            </span>
                        </div>
                    </div>
                </section>

                {/* Action Buttons */}
                <section className="mb-8">
                    {stakingType ? (
                        <div className="bg-card border border-border rounded-xl p-6 animate-in fade-in zoom-in-95">
                            <h3 className="font-bold text-lg mb-2">
                                Confirm {stakingType === 'back' ? 'Backing' : 'Challenge'}
                            </h3>
                            <p className="text-muted-foreground text-sm mb-4">
                                You are about to stake 100 USDC on this prediction.
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setStakingType(null)}
                                    className="flex-1 py-3 rounded-xl font-medium hover:bg-secondary transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={async () => {
                                        await stakeOnCall(id, 100, stakingType);
                                        setStakingType(null);
                                    }}
                                    className={`flex-1 py-3 rounded-xl font-bold text-white transition-colors ${stakingType === 'back' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'
                                        }`}
                                >
                                    Confirm Stake
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => setStakingType('back')}
                                className="py-4 rounded-xl bg-green-500/10 text-green-500 font-bold hover:bg-green-500/20 transition-colors flex flex-col items-center gap-1 border border-green-500/20"
                            >
                                <span>Back this Call</span>
                                <span className="text-xs font-normal opacity-80">Agree with prediction</span>
                            </button>
                            <button
                                onClick={() => setStakingType('challenge')}
                                className="py-4 rounded-xl bg-red-500/10 text-red-500 font-bold hover:bg-red-500/20 transition-colors flex flex-col items-center gap-1 border border-red-500/20"
                            >
                                <span>Challenge</span>
                                <span className="text-xs font-normal opacity-80">Bet against it</span>
                            </button>
                        </div>
                    )}
                </section>

                {/* Activity Log / Order Book */}
                <section className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Users className="h-5 w-5 text-primary" />
                        <h3 className="text-xl font-bold">Recent Activity</h3>
                    </div>
                    <ActivityLog />
                </section>

                {/* Interaction Stats */}
                <div className="flex items-center justify-between border-y border-border py-4">
                    <div className="flex gap-6">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Users className="h-5 w-5" />
                            <span className="font-medium">{call.backers} Backers</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <MessageSquare className="h-5 w-5" />
                            <span className="font-medium">{call.comments} Comments</span>
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}

function Badge({ icon, label, color }: { icon: React.ReactNode, label: string, color: 'primary' | 'secondary' | 'accent' }) {
    const colors = {
        primary: "bg-primary/10 text-primary border-primary/20",
        secondary: "bg-secondary text-muted-foreground border-border",
        accent: "bg-accent/10 text-accent border-accent/20",
    };

    return (
        <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border", colors[color])}>
            {icon}
            {label}
        </div>
    );
}
