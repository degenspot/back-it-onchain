"use client";

import { cn } from "@/lib/utils";

interface ChainBadgeProps {
  chain: "base" | "stellar";
  className?: string;
}

export function ChainBadge({ chain, className }: ChainBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        chain === "base"
          ? "bg-blue-500/10 text-blue-500 border border-blue-500/20"
          : "bg-purple-500/10 text-purple-400 border border-purple-500/20",
        className
      )}
      data-testid={`chain-badge-${chain}`}
    >
      {chain === "base" ? "🔵" : "⭐"} {chain === "base" ? "Base" : "Stellar"}
    </span>
  );
}
