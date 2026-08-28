"use client";

import { useEffect, useMemo, useState } from "react";
import { Trophy, TrendingUp, Target, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { useGlobalState } from "@/components/GlobalState";
import { ChainBadge } from "@/components/ChainBadge";
import { Button } from "@/components/ui/Button";

type LeaderboardPeriod = "all" | "weekly" | "monthly";

interface LeaderboardEntry {
  rank: number;
  userId: string;
  winRate: number;
  profit: number;
  activity: number;
  chain?: "base" | "stellar";
}

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

const PERIOD_OPTIONS: Array<{ label: string; value: LeaderboardPeriod }> = [
  { label: "All", value: "all" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

const PAGE_SIZE = 20;

const formatWallet = (value: string): string => {
  if (!value) return "-";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const formatProfit = (value: number): string => {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
  if (value > 0) return `+${formatted}`;
  return formatted;
};

export default function LeaderboardPage() {
  const { currentUser } = useGlobalState();
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${API_BASE_URL}/leaderboard?period=${period}&limit=100`
        );
        if (!response.ok) throw new Error("Failed to load leaderboard");
        const data: LeaderboardEntry[] = await response.json();
        setEntries(Array.isArray(data) ? data : []);
      } catch {
        setEntries([]);
        setError("Unable to load leaderboard right now.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchLeaderboard();
    setPage(1);
  }, [period]);

  const podium = useMemo(() => entries.slice(0, 3), [entries]);
  const totalPages = Math.max(1, Math.ceil((entries.length - 3) / PAGE_SIZE));
  const paginatedEntries = useMemo(() => {
    const afterPodium = entries.slice(3);
    const start = (page - 1) * PAGE_SIZE;
    return afterPodium.slice(start, start + PAGE_SIZE);
  }, [entries, page]);

  const currentUserEntry = useMemo(() => {
    if (!currentUser?.wallet) return null;
    return entries.find(
      (e) => e.userId.toLowerCase() === currentUser.wallet.toLowerCase()
    ) ?? null;
  }, [entries, currentUser]);

  const RightSidebar = (
    <div className="space-y-4">
      <div className="bg-secondary/20 rounded-xl p-6 border border-border">
        <h3 className="font-bold text-lg mb-2">Top Predictors</h3>
        <p className="text-sm text-muted-foreground">
          Rankings update by performance, win-rate, and consistency.
        </p>
      </div>
      <div className="bg-secondary/20 rounded-xl p-6 border border-border space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" /> Active users ranked
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Target className="h-4 w-4" /> Win rate weighted
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TrendingUp className="h-4 w-4" /> Profit and activity
        </div>
      </div>
    </div>
  );

  return (
    <AppLayout rightSidebar={RightSidebar}>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between px-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" /> Leaderboard
          </h1>
        </div>

        <div className="flex gap-3 border-b border-border px-2">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setPeriod(option.value)}
              className={`pb-3 border-b-2 font-bold transition-colors ${
                period === option.value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Podium */}
        {podium.length >= 3 && (
          <div className="flex items-end justify-center gap-4 py-6">
            {[1, 0, 2].map((idx) => {
              const entry = podium[idx];
              if (!entry) return null;
              const heights = ["h-32", "h-24", "h-20"];
              const medals = ["🥇", "🥈", "🥉"];
              return (
                <div key={entry.userId} className="flex flex-col items-center gap-2">
                  <div className="text-2xl">{medals[idx]}</div>
                  <div className="font-bold text-sm text-center">{formatWallet(entry.userId)}</div>
                  <div className="text-xs text-muted-foreground">{entry.winRate.toFixed(1)}%</div>
                  <div className={`w-20 ${heights[idx]} bg-gradient-to-t from-primary/20 to-primary/5 rounded-t-lg border border-primary/20 flex items-center justify-center`}>
                    <span className="text-lg font-bold">#{idx === 0 ? 1 : idx === 1 ? 2 : 3}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading leaderboard...</div>
        ) : error ? (
          <div className="rounded-xl border border-border bg-secondary/20 p-6 text-sm text-muted-foreground">{error}</div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-secondary/10 p-10 text-center text-muted-foreground">
            No leaderboard data available for this period.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-border overflow-hidden bg-card">
              <div className="grid grid-cols-[64px_1fr_100px_110px_90px_80px] gap-3 px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground border-b border-border bg-secondary/20">
                <span>Rank</span>
                <span>User</span>
                <span className="text-right">Win Rate</span>
                <span className="text-right">Profit</span>
                <span className="text-right">Activity</span>
                <span>Chain</span>
              </div>
              {paginatedEntries.map((entry) => {
                const globalRank = entry.rank;
                const isCurrentUser = currentUser?.wallet &&
                  entry.userId.toLowerCase() === currentUser.wallet.toLowerCase();
                return (
                  <div
                    key={`${entry.rank}-${entry.userId}`}
                    className={`grid grid-cols-[64px_1fr_100px_110px_90px_80px] gap-3 px-4 py-3 border-b border-border/60 text-sm ${isCurrentUser ? "bg-primary/10" : ""}`}
                  >
                    <span className="font-bold">#{globalRank}</span>
                    <span className="font-medium truncate">{formatWallet(entry.userId)}</span>
                    <span className="text-right tabular-nums">{entry.winRate.toFixed(2)}%</span>
                    <span className={`text-right tabular-nums ${entry.profit > 0 ? "text-green-500" : entry.profit < 0 ? "text-red-500" : ""}`}>
                      {formatProfit(entry.profit)}
                    </span>
                    <span className="text-right tabular-nums">{entry.activity}</span>
                    <span>{entry.chain && <ChainBadge chain={entry.chain} />}</span>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}

        {currentUserEntry && currentUserEntry.rank > 10 && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
            <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">Your Rank</p>
            <div className="grid grid-cols-[64px_1fr_100px_110px_90px_80px] gap-3 text-sm">
              <span className="font-bold">#{currentUserEntry.rank}</span>
              <span className="font-medium truncate">{formatWallet(currentUserEntry.userId)}</span>
              <span className="text-right tabular-nums">{currentUserEntry.winRate.toFixed(2)}%</span>
              <span className={`text-right tabular-nums ${currentUserEntry.profit > 0 ? "text-green-500" : currentUserEntry.profit < 0 ? "text-red-500" : ""}`}>
                {formatProfit(currentUserEntry.profit)}
              </span>
              <span className="text-right tabular-nums">{currentUserEntry.activity}</span>
              <span>{currentUserEntry.chain && <ChainBadge chain={currentUserEntry.chain} />}</span>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
