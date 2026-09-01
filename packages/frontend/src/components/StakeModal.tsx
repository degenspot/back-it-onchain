"use client";

import { useEffect } from "react";
import { X, Loader2, CheckCircle2, ArrowUpRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useStake, type StakePosition } from "@/hooks/useStake";

interface StakeModalProps {
  open: boolean;
  onClose: () => void;
  callId: string;
  callTitle?: string;
}

export function StakeModal({ open, onClose, callId, callTitle }: StakeModalProps) {
  const {
    position, setPosition,
    amount, setAmount,
    state, maxAmount,
    executeStake, reset,
  } = useStake(callId);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button type="button" aria-label="Close" tabIndex={-1} className="fixed inset-0 bg-black/80" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-xl" data-testid="stake-modal">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-xl font-bold mb-1">Place Stake</h2>
        {callTitle && <p className="text-sm text-muted-foreground mb-4">{callTitle}</p>}

        {/* Position Toggle */}
        <div className="flex gap-2 mb-4">
          {(["YES", "NO"] as StakePosition[]).map((pos) => (
            <button
              key={pos}
              onClick={() => setPosition(pos)}
              className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all border ${
                position === pos
                  ? pos === "YES"
                    ? "bg-green-500/20 border-green-500 text-green-500"
                    : "bg-red-500/20 border-red-500 text-red-500"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
              data-testid={`stake-position-${pos}`}
            >
              {pos}
            </button>
          ))}
        </div>

        {/* Amount Input */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="stake-amount" className="text-sm font-medium">Amount</label>
            <button onClick={() => setAmount(String(maxAmount))} className="text-xs text-primary hover:underline">
              Max: {maxAmount}
            </button>
          </div>
          <input
            id="stake-amount"
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            max={maxAmount}
            className="w-full bg-secondary/50 border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 text-lg font-mono"
            data-testid="stake-amount-input"
          />
        </div>

        {/* Estimated Payout */}
        {parseFloat(amount) > 0 && (
          <div className="bg-secondary/30 rounded-lg p-3 mb-4">
            <p className="text-xs text-muted-foreground">Estimated payout</p>
            <p className="text-sm font-medium">${(parseFloat(amount) * 1.5).toFixed(2)} <span className="text-green-500">(+50%)</span></p>
          </div>
        )}

        {/* Error State */}
        {state.step === "error" && state.error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-500">{state.error}</p>
          </div>
        )}

        {/* Success State */}
        {state.step === "success" && state.txHash && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <p className="text-sm font-medium text-green-500">Stake submitted!</p>
            </div>
            <a
              href={`https://sepolia.basescan.org/tx/${state.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary flex items-center gap-1 hover:underline"
            >
              View on explorer <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        )}

        {/* Action Button */}
        <Button
          onClick={state.step === "success" ? onClose : executeStake}
          disabled={(!amount || parseFloat(amount) <= 0) && state.step !== "success"}
          className="w-full"
          data-testid="stake-submit"
        >
          {state.step === "approving" ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Approving...</>
          ) : state.step === "staking" ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Staking...</>
          ) : state.step === "success" ? (
            "Done"
          ) : (
            `Stake ${position}`
          )}
        </Button>
      </div>
    </div>
  );
}
