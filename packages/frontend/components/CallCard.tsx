"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TrendingUp, Clock, ShieldCheck, MessageSquare, MoreHorizontal, Flag } from "lucide-react";

interface CallCardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any;
  onQuickStake?: (call: any) => void;
}

const CHAIN_CONFIG = {
  base: {
    name: "Base",
    explorer: "https://basescan.org",
    color: "bg-blue-500",
    textColor: "text-blue-500",
    borderColor: "border-blue-500/20",
    bgColor: "bg-blue-500/10",
  },
  stellar: {
    name: "Stellar",
    explorer: "https://stellar.expert/explorer/public",
    color: "bg-purple-500",
    textColor: "text-purple-500",
    borderColor: "border-purple-500/20",
    bgColor: "bg-purple-500/10",
  },
};

function ChainBadge({ chain }: { chain: "base" | "stellar" }) {
  const config = CHAIN_CONFIG[chain] || CHAIN_CONFIG.base;
  return (
    <div
      className={`px-2 py-1 rounded-full ${config.bgColor} ${config.textColor} text-xs font-bold border ${config.borderColor} flex items-center gap-1`}
    >
      <div className={`w-2 h-2 rounded-full ${config.color}`} />
      {config.name}
    </div>
  );
}

function getExplorerUrl(chain: "base" | "stellar", address: string): string {
  const config = CHAIN_CONFIG[chain] || CHAIN_CONFIG.base;
  if (chain === "stellar") {
    return `${config.explorer}/account/${address}`;
  }
  return `${config.explorer}/address/${address}`;
}

export function CallCard({ call }: CallCardProps) {
  const chain = call.chain || "base";
  const explorerUrl = getExplorerUrl(
    chain,
    call.creatorWallet || call.creator?.wallet,
  );

  // Countdown state
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  useEffect(() => {
    function compute() {
      const now = Date.now();
      const end = new Date(call.endTs).getTime();
      const diff = Math.max(0, end - now);
      if (diff === 0) return setTimeRemaining("Ended");
      const mins = Math.floor(diff / 60000);
      if (mins < 60) return setTimeRemaining(`Ends in ${mins}m`);
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return setTimeRemaining(`Ends in ${hrs}h`);
      const days = Math.floor(hrs / 24);
      return setTimeRemaining(`Ends in ${days}d`);
    }
    compute();
    const t = setInterval(compute, 1000 * 30);
    return () => clearInterval(t);
  }, [call.endTs]);

  // Determine "hot" markets by simple heuristic: large pool
  const pool = (parseFloat(call.totalStakeYes || 0) || 0) + (parseFloat(call.totalStakeNo || 0) || 0);
  const isHot = pool >= 100; // threshold for pulse animation

  // Optimistic UI state
  const [isReported, setIsReported] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [isReporting, setIsReporting] = useState(false);

  // If reported optimistically, hide the component from the feed
  if (isReported) {
    return null;
  }

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason.trim()) return;

    setIsReporting(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      await fetch(`${apiUrl}/calls/${call.id}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: reportReason }),
      });
      // Optimistically hide the card
      setIsReported(true);
    } catch (error) {
      console.error("Failed to report call", error);
    } finally {
      setIsReporting(false);
      setShowReportModal(false);
      setReportReason("");
    }
  };

  return (
    <>
      <Link href={`/calls/${call.id}`} className="block group">
        <div className={`bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5 ${isHot ? 'ring-2 ring-red-400/20 animate-pulse' : ''}`}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center font-bold text-white text-xs`}
              >
                {(call.creator?.displayName || "U").substring(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-sm group-hover:text-primary transition-colors">
                  {call.creator?.displayName ||
                    call.creator?.wallet?.slice(0, 6) ||
                    "Unknown User"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(call.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ChainBadge chain={chain} />
              <div className="px-2 py-1 rounded-full bg-green-500/10 text-green-500 text-xs font-bold border border-green-500/20">
                {call.status}
              </div>

              {/* Ellipsis Dropdown Menu */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowOptions(!showOptions);
                  }}
                  className="p-1 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="More options"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>

                {showOptions && (
                  <div
                    className="absolute right-0 top-full mt-1 w-40 bg-card border border-border rounded-lg shadow-lg z-50 py-1"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <button
                      onClick={() => {
                        setShowOptions(false);
                        setShowReportModal(true);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-secondary flex items-center gap-2 transition-colors"
                    >
                      <Flag className="w-4 h-4" />
                      Report Call
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <h3 className="text-lg font-bold mb-2 leading-snug">
            {call.conditionJson?.title || call.title || "Untitled Call"}
          </h3>

          <div className="flex flex-wrap gap-3 mb-4">
            <Badge
              icon={<TrendingUp className="h-3 w-3" />}
              label={`${call.stakeToken} Pool`}
            />
            <Badge
              icon={<Clock className="h-3 w-3" />}
              label={timeRemaining}
            />
            <Badge
              icon={<ShieldCheck className="h-3 w-3" />}
              label={`Pool: ${parseFloat(call.totalStakeYes || 0) + parseFloat(call.totalStakeNo || 0)}`}
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-border relative">
            <div className="flex gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <span className="font-bold text-green-500">
                  {call.totalStakeYes || 0}
                </span>{" "}
                YES
              </div>
              <div className="flex items-center gap-1">
                <span className="font-bold text-red-500">
                  {call.totalStakeNo || 0}
                </span>{" "}
                NO
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                View on Explorer ↗
              </a>
              <div className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary transition-colors">
                <MessageSquare className="h-3 w-3" />
                {call.comments || 0} Comments
              </div>
            </div>
            {/* Quick Stake visible on hover */}
            <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // trigger a custom event so parent can open modal if provided
                  const ev = new CustomEvent('quick-stake', { detail: call });
                  window.dispatchEvent(ev);
                }}
                className="px-3 py-1 rounded-md bg-primary text-white text-sm shadow-sm hover:brightness-95"
              >
                Quick Stake
              </button>
            </div>
          </div>
        </div>
      </Link>

      {/* Report Modal */}
      {showReportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">Report Content</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Please tell us why you are reporting this call.
            </p>
            <form onSubmit={handleReportSubmit}>
              <textarea
                className="w-full bg-secondary border border-border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 mb-4 min-h-[100px]"
                placeholder="Reason for reporting..."
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                required
              />
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="px-4 py-2 text-sm font-medium hover:text-muted-foreground transition-colors"
                  disabled={isReporting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                  disabled={isReporting || !reportReason.trim()}
                >
                  {isReporting ? 'Reporting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Badge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/50 text-xs font-medium text-muted-foreground border border-border/50 shadow-sm backdrop-blur-sm">
      {icon}
      {label}
    </div>
  );
}
