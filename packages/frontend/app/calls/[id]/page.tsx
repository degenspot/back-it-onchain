
"use client";

import { useParams } from "next/navigation";
import { AppLayout } from "@/components/AppLayout";
import { ArrowLeft, TrendingUp, Clock, ShieldCheck, Users, MessageSquare, Share2, Flag } from 'lucide-react';
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useGlobalState } from "@/components/GlobalState";
import { useState } from "react";
import { Loader } from "@/components/ui/Loader";


export default function CallDetailPage() {
    const params = useParams();
    const id = params?.id as string;
    const { calls, stakeOnCall, isLoading } = useGlobalState();
    const [stakingType, setStakingType] = useState<'back' | 'challenge' | null>(null);

    const call = calls.find(c => c.id === id);

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

    const RightSidebar = (
        <div className="space-y-6">
            <div className="bg-secondary/20 rounded-xl p-6 border border-border">
                <h3 className="font-bold text-lg mb-2">Market Stats</h3>
                <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Volume</span>
                        <span className="font-medium">{call.volume}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Participants</span>
                        <span className="font-medium">{call.backers}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Liquidity</span>
                        <span className="font-medium">$5,000</span>
                    </div>
                </div>
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
                <h1 className="text-lg font-bold truncate">Call Details</h1>
            </header>

            <div className="p-6">
                {/* Call Header */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-4">
                        <div className={`h-10 w-10 rounded-full ${call.creator.avatar || 'bg-primary'} flex items-center justify-center font-bold text-white text-sm`}>
                            {(call.creator.name || 'Anonymous').substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                            <div className="font-bold">{call.creator.name || 'Anonymous'}</div>
                            <div className="text-xs text-muted-foreground">{call.creator.handle || '@anonymous'} • {call.createdAt}</div>
                        </div>
                    </div>

                    <h1 className="text-2xl font-bold mb-4 leading-tight">{call.title}</h1>

                    <div className="flex flex-wrap gap-3 mb-6">
                        <Badge icon={<TrendingUp className="h-4 w-4" />} label={`${call.asset} ➜ ${call.target}`} color="primary" />
                        <Badge icon={<ShieldCheck className="h-4 w-4" />} label={`Stake: ${call.stake}`} color="accent" />
                        <Badge icon={<Clock className="h-4 w-4" />} label={`By ${call.deadline}`} color="secondary" />
                    </div>

                    <div className="bg-secondary/30 rounded-xl p-6 border border-border mb-8">
                        <h3 className="font-bold mb-2 text-sm uppercase tracking-wider text-muted-foreground">Thesis</h3>
                        <p className="text-lg leading-relaxed">{call.thesis}</p>
                    </div>

                    {/* Action Buttons */}
                    {/* Action Buttons */}
                    <div className="mb-8">
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
                    </div>

                    {/* Interaction Stats */}
                    <div className="flex items-center justify-between border-y border-border py-4 mb-8">
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
                        <div className="flex gap-2">
                            <button className="p-2 hover:bg-secondary rounded-full transition-colors text-muted-foreground hover:text-foreground">
                                <Share2 className="h-5 w-5" />
                            </button>
                            <button className="p-2 hover:bg-secondary rounded-full transition-colors text-muted-foreground hover:text-foreground">
                                <Flag className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                    <h3 className="text-xl font-bold mb-2 group-hover:text-red-500 transition-colors">Counter-Back</h3>
                    <p className="text-muted-foreground mb-4">Think this is wrong? Stake ETH against this prediction to win the creator's stake.</p>
                    <div
                        onClick={() => setStakingType('challenge')}
                        className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-center transition-colors cursor-pointer"
                    >
                        Back "No"
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}

function StatCard({ icon: Icon, label, value, subValue }: { icon: any, label: string, value: string, subValue: string }) {
    return (
        <div className="bg-secondary/50 rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Icon className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
            </div>
            <div className="font-bold text-lg">{value}</div>
            <div className="text-xs text-muted-foreground">{subValue}</div>
        </div>
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
