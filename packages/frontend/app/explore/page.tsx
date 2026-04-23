"use client";

import { AppLayout } from "@/components/AppLayout";
import { Search, TrendingUp } from 'lucide-react';

/** Trigger the global Cmd/Ctrl+K search palette programmatically */
function openSearchPalette() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
  );
}

export default function ExplorePage() {
    const RightSidebar = (
        <div className="space-y-6">
            <div>
                <h3 className="font-bold text-lg mb-4">Who to follow</h3>
                <div className="space-y-4">
                    <SuggestedUser name="VitalikButerin" handle="@vitalik" />
                    <SuggestedUser name="Brian Armstrong" handle="@brian_armstrong" />
                    <SuggestedUser name="Jesse Pollak" handle="@jessepollak" />
                </div>
            </div>
        </div>
    );

    return (
        <AppLayout rightSidebar={RightSidebar}>
            <div className="p-4">
                {/* Search Bar — opens Cmd/Ctrl+K palette */}
                <button
                  onClick={openSearchPalette}
                  className="relative w-full mb-8 flex items-center gap-3 bg-secondary/50 border border-border rounded-xl px-4 py-3 text-muted-foreground hover:border-primary/50 transition-colors text-left"
                >
                  <Search className="h-5 w-5 shrink-0" />
                  <span className="flex-1 text-sm">Search markets, users, or tokens…</span>
                  <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px]">
                    ⌘K
                  </kbd>
                </button>

                {/* Trending Topics */}
                <section className="mb-8">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-primary" />
                        Trending Topics
                    </h2>
                    <div className="grid grid-cols-2 gap-3">
                        <TopicCard topic="Ethereum ETF" calls="1.2k" />
                        <TopicCard topic="Base L2" calls="850" />
                        <TopicCard topic="Solana Memes" calls="3.4k" />
                        <TopicCard topic="US Election" calls="5.6k" />
                    </div>
                </section>

                {/* Suggested Markets */}
                <section>
                    <h2 className="text-xl font-bold mb-4">Suggested Markets</h2>
                    <div className="space-y-3">
                        <SuggestedMarket
                            title="Bitcoin to break $100k in 2025"
                            volume="$2.5M"
                            change="+12%"
                        />
                        <SuggestedMarket
                            title="Farcaster to reach 1M DAU"
                            volume="$500k"
                            change="+5%"
                        />
                        <SuggestedMarket
                            title="Coinbase stock (COIN) > $300"
                            volume="$1.2M"
                            change="-2%"
                        />
                    </div>
                </section>
            </div>
        </AppLayout>
    );
}

function TopicCard({ topic, calls }: { topic: string; calls: string }) {
    return (
        <div className="p-4 rounded-xl bg-card border border-border hover:border-primary/50 cursor-pointer transition-colors group">
            <h3 className="font-bold group-hover:text-primary transition-colors">{topic}</h3>
            <p className="text-sm text-muted-foreground">{calls} calls</p>
        </div>
    );
}

function SuggestedMarket({ title, volume, change }: { title: string; volume: string; change: string }) {
    const isPositive = change.startsWith('+');
    return (
        <div className="flex items-center justify-between p-4 rounded-xl bg-card border border-border hover:bg-secondary/30 cursor-pointer transition-colors">
            <div>
                <h3 className="font-medium mb-1">{title}</h3>
                <p className="text-xs text-muted-foreground">Vol: {volume}</p>
            </div>
            <div className={`text-sm font-bold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                {change}
            </div>
        </div>
    );
}

function SuggestedUser({ name, handle }: { name: string; handle: string }) {
    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center font-bold text-xs">
                    {name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                    <p className="font-medium text-sm">{name}</p>
                    <p className="text-xs text-muted-foreground">{handle}</p>
                </div>
            </div>
            <button className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors">
                Follow
            </button>
        </div>
    );
}
