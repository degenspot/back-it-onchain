"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useGlobalState } from "@/components/GlobalState";
import { CallCard } from "@/components/CallCard";
import { CallCardSkeleton } from "@/components/CallCardSkeleton";
import { type Call, type User } from "@/lib/types";


const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

const PAGE_SIZE = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCall(c: any): Call {
  return {
    id: c.callOnchainId || c.id.toString(),
    title: c.conditionJson?.title || "Call #" + (c.callOnchainId || c.id),
    thesis: c.conditionJson?.thesis || "Thesis for " + (c.pairId || "this call"),
    asset: c.pairId
      ? Buffer.from(c.pairId.replace("0x", ""), "hex")
          .toString()
          .replace(/\0/g, "")
      : "Unknown",
    target: c.conditionJson?.target || "TBD",
    deadline: new Date(c.endTs).toLocaleDateString(),
    stake: `${c.totalStakeYes || 0} ${c.stakeToken || "USDC"}`,
    creator: (typeof c.creator === 'string' ? { wallet: c.creator } : (c.creator || {
      wallet: c.creatorWallet,
      handle: c.creatorWallet?.slice(0, 6),
    })) as User,
    status: c.status || "active",
    createdAt: c.createdAt,
    backers: 0,
    comments: 0,
    volume: `$${(
      Number(c.totalStakeYes || 0) + Number(c.totalStakeNo || 0)
    ).toLocaleString()}`,
    totalStakeYes: Number(c.totalStakeYes || 0),
    totalStakeNo: Number(c.totalStakeNo || 0),
    stakeToken: c.stakeToken || "USDC",
    endTs: c.endTs,
    conditionJson: c.conditionJson,
  };
}

export default function FeedPage() {
  const { currentUser } = useGlobalState();
  const [activeTab, setActiveTab] = useState<"for-you" | "following">(
    "for-you",
  );
  const [calls, setCalls] = useState<Call[]>([]);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    async (tab: "for-you" | "following", pageOffset: number) => {
      if (tab === "following" && !currentUser) {
        setCalls([]);
        setHasMore(false);
        return;
      }
      setIsLoading(true);
      try {
        const base =
          tab === "following"
            ? `${API_BASE_URL}/feed/following?wallet=${currentUser!.wallet}&limit=${PAGE_SIZE}&offset=${pageOffset}`
            : `${API_BASE_URL}/feed/for-you?limit=${PAGE_SIZE}&offset=${pageOffset}`;

        const res = await fetch(base);
        if (!res.ok) throw new Error("Failed to fetch feed");
        const data = await res.json();
        const mapped: Call[] = data.map(mapCall);

        setCalls((prev) => (pageOffset === 0 ? mapped : [...prev, ...mapped]));
        setHasMore(mapped.length === PAGE_SIZE);
      } catch {
        if (pageOffset === 0) setCalls([]);
        setHasMore(false);
      } finally {
        setIsLoading(false);
      }
    },
    [currentUser],
  );

  // Reset and reload when tab changes
  useEffect(() => {
    setCalls([]);
    setOffset(0);
    setHasMore(true);
    fetchPage(activeTab, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          const nextOffset = offset + PAGE_SIZE;
          setOffset(nextOffset);
          fetchPage(activeTab, nextOffset);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, offset, activeTab, fetchPage]);

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
            onClick={() => setActiveTab("for-you")}
            className={`pb-3 border-b-2 font-bold transition-colors ${
              activeTab === "for-you"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            For You
          </button>
          <button
            onClick={() => setActiveTab("following")}
            className={`pb-3 border-b-2 font-bold transition-colors ${
              activeTab === "following"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Following
          </button>
        </div>

        {/* Feed */}
        <div className="space-y-4">
          {calls.length === 0 && !isLoading && (
            <div className="text-center py-10 text-muted-foreground">
              {activeTab === "following"
                ? "Follow users to see their calls here."
                : "No calls found."}
            </div>
          )}

          {calls.map((call) => (
            <CallCard key={call.id} call={call} />
          ))}

          {/* Skeleton loaders while fetching next page */}
          {isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <CallCardSkeleton key={`skeleton-${i}`} />
            ))}

          {/* Sentinel for IntersectionObserver */}
          <div ref={sentinelRef} className="h-1" />

          {/* End of feed */}
          {!hasMore && calls.length > 0 && (
            <p className="text-center py-6 text-sm text-muted-foreground">
              You&apos;ve reached the end of the feed.
            </p>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
