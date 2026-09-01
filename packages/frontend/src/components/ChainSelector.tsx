"use client";

import { cn } from "@/lib/utils";
import { useChain, type ChainType } from "@/lib/chain-context";

interface ChainSelectorProps {
  className?: string;
}

export function ChainSelector({ className }: ChainSelectorProps) {
  const { chain, setChain } = useChain();

  const chains: Array<{ value: ChainType; label: string; icon: string }> = [
    { value: "base", label: "Base", icon: "🔵" },
    { value: "stellar", label: "Stellar", icon: "⭐" },
  ];

  return (
    <div
      className={cn("flex gap-1 p-1 rounded-xl bg-secondary/50 border border-border", className)}
      data-testid="chain-selector"
      role="radiogroup"
      aria-label="Select blockchain"
    >
      {chains.map((c) => (
        <button
          key={c.value}
          onClick={() => setChain(c.value)}
          role="radio"
          aria-checked={chain === c.value}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
            chain === c.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          )}
          data-testid={`chain-option-${c.value}`}
        >
          <span>{c.icon}</span>
          <span className="hidden sm:inline">{c.label}</span>
        </button>
      ))}
    </div>
  );
}
