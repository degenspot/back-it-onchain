"use client";

import { useEffect, useMemo, useState } from "react";
import { Trophy, TrendingUp, Target, Users } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { useGlobalState } from "@/components/GlobalState";

type LeaderboardPeriod = "weekly" | "all_time";

interface LeaderboardEntry {
  rank: number;
  userId: string;
  winRate: number;
  profit: number;
  activity: number;
}

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

const PERIOD_OPTIONS: Array<{ label: string; value: LeaderboardPeriod }> = [
  { label: "Weekly", value: "weekly" },
  { label: "All-Time", value: "all_time" },
];

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
  const [period, setPeriod] = useState<LeaderboardPeriod>("weekly");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/leaderboard?period=${period}&limit=100`
        );

        if (!response.ok) {
          throw new Error("Failed to load leaderboard");
        }

        const data: LeaderboardEntry[] = await response.json();
        setEntries(Array.isArray(data) ? data : []);
      } catch (fetchError) {
        console.error("Leaderboard fetch error:", fetchError);
        setEntries([]);
        setError("Unable to load leaderboard right now.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, [period]);

  const topTen = useMemo(() => entries.slice(0, 10), [entries]);

  const currentUserEntry = useMemo(() => {
    if (!currentUser?.wallet) return null;
    return (
      entries.find(
        (entry) => entry.userId.toLowerCase() === currentUser.wallet.toLowerCase()
      ) ?? null
    );
  }, [entries, currentUser]);

  const showCurrentUserOutsideTopTen =
    currentUserEntry !== null && currentUserEntry.rank > 10;

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
          <Users className="h-4 w-4" />
          Active users ranked
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Target className="h-4 w-4" />
          Win rate weighted
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TrendingUp className="h-4 w-4" />
          Profit and activity included
        </div>
      </div>
    </div>
  );

  return (
    <AppLayout rightSidebar={RightSidebar}>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between px-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" />
            Leaderboard
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

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading leaderboard...</div>
        ) : error ? (
          <div className="rounded-xl border border-border bg-secondary/20 p-6 text-sm text-muted-foreground">
            {error}
          </div>
        ) : topTen.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-secondary/10 p-10 text-center text-muted-foreground">
            No leaderboard data available for this period.
          </div>
        ) : (
          <div className="rounded-2xl border border-border overflow-hidden bg-card">
            <div className="grid grid-cols-[64px_1fr_110px_110px_90px] gap-3 px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground border-b border-border bg-secondary/20">
              <span>Rank</span>
              <span>User</span>
              <span className="text-right">Win Rate</span>
              <span className="text-right">Profit</span>
              <span className="text-right">Activity</span>
            </div>

            {topTen.map((entry) => {
              const isCurrentUser =
                currentUser?.wallet &&
                entry.userId.toLowerCase() === currentUser.wallet.toLowerCase();

              return (
                <div
                  key={`${entry.rank}-${entry.userId}`}
                  className={`grid grid-cols-[64px_1fr_110px_110px_90px] gap-3 px-4 py-3 border-b border-border/60 text-sm ${
                    isCurrentUser ? "bg-primary/10" : ""
                  }`}
                >
                  <span className="font-bold">#{entry.rank}</span>
                  <span className="font-medium truncate">{formatWallet(entry.userId)}</span>
                  <span className="text-right tabular-nums">{entry.winRate.toFixed(2)}%</span>
                  <span
                    className={`text-right tabular-nums ${
                      entry.profit > 0 ? "text-green-500" : entry.profit < 0 ? "text-red-500" : ""
                    }`}
                  >
                    {formatProfit(entry.profit)}
                  </span>
                  <span className="text-right tabular-nums">{entry.activity}</span>
                </div>
              );
            })}
          </div>
        )}

        {showCurrentUserOutsideTopTen && currentUserEntry && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
            <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">
              Your Rank
            </p>
            <div className="grid grid-cols-[64px_1fr_110px_110px_90px] gap-3 text-sm">
              <span className="font-bold">#{currentUserEntry.rank}</span>
              <span className="font-medium truncate">{formatWallet(currentUserEntry.userId)}</span>
              <span className="text-right tabular-nums">{currentUserEntry.winRate.toFixed(2)}%</span>
              <span
                className={`text-right tabular-nums ${
                  currentUserEntry.profit > 0
                    ? "text-green-500"
                    : currentUserEntry.profit < 0
                      ? "text-red-500"
                      : ""
                }`}
              >
                {formatProfit(currentUserEntry.profit)}
              </span>
              <span className="text-right tabular-nums">{currentUserEntry.activity}</span>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}