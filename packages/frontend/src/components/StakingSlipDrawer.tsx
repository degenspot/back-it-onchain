'use client';

import * as React from 'react';
import { Check, ChevronDown, CircleAlert, Loader, Minus, Plus, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useGlobalState } from '@/components/GlobalState';
import { useStakingSlip, type SlipSide } from '@/src/context/StakingSlipContext';
import { cn } from '@/lib/utils';

const sideLabel: Record<SlipSide, string> = {
  back: 'Back',
  challenge: 'Counter-stake',
};

export function StakingSlipDrawer() {
  const { items, isOpen, close, openWithCall, updateItem, removeItem, clearCompleted, totalAmount, execute } = useStakingSlip();
  const { stakeOnCall } = useGlobalState();
  const [isExecuting, setIsExecuting] = React.useState(false);

  React.useEffect(() => {
    const handleQuickStake = (event: Event) => {
      const call = (event as CustomEvent<Parameters<typeof openWithCall>[0]>).detail;
      if (call) openWithCall(call);
    };
    window.addEventListener('quick-stake', handleQuickStake);
    return () => window.removeEventListener('quick-stake', handleQuickStake);
  }, [openWithCall]);

  if (!isOpen) return null;

  const run = async () => {
    setIsExecuting(true);
    await execute(async (item) => {
      await stakeOnCall(item.callId, item.amount, item.side);
      return {};
    });
    setIsExecuting(false);
    if (items.some((item) => item.status === 'failed')) {
      toast.error('Some positions could not be submitted. Review the failed items and retry.');
    } else {
      toast.success('Staking slip submitted.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button type="button" aria-label="Close staking slip" className="absolute inset-0 bg-black/50" onClick={close} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="staking-slip-title"
        className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 id="staking-slip-title" className="text-lg font-bold">Staking slip</h2>
            <p className="text-xs text-muted-foreground">Queue positions and submit them in order.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded p-1 hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Select Quick Stake on a call to add it here.
            </div>
          ) : null}
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.asset} · {sideLabel[item.side]}</p>
                </div>
                <span className={cn(
                  'rounded-full px-2 py-1 text-[11px] font-medium',
                  item.status === 'confirmed' && 'bg-green-500/15 text-green-500',
                  item.status === 'failed' && 'bg-red-500/15 text-red-500',
                  item.status === 'submitting' && 'bg-blue-500/15 text-blue-500',
                  item.status === 'draft' && 'bg-secondary text-muted-foreground',
                )}>
                  {item.status}
                </span>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Decrease ${item.title} amount`}
                  disabled={item.status === 'submitting'}
                  onClick={() => updateItem(item.id, { amount: Math.max(0, item.amount - 10) })}
                  className="rounded border border-border p-1.5 hover:bg-secondary disabled:opacity-50"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <label className="flex-1">
                  <span className="sr-only">Amount in {item.token}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.amount}
                    disabled={item.status === 'submitting' || item.status === 'confirmed'}
                    onChange={(event) => updateItem(item.id, { amount: Number(event.target.value) })}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Increase ${item.title} amount`}
                  disabled={item.status === 'submitting'}
                  onClick={() => updateItem(item.id, { amount: item.amount + 10 })}
                  className="rounded border border-border p-1.5 hover:bg-secondary disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  disabled={item.status === 'submitting' || item.status === 'confirmed'}
                  onClick={() => updateItem(item.id, { side: item.side === 'back' ? 'challenge' : 'back' })}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Switch to {sideLabel[item.side === 'back' ? 'challenge' : 'back']} <ChevronDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={item.status === 'submitting'}
                  className="text-xs text-muted-foreground hover:text-red-500 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
              {item.error ? <p className="mt-3 flex gap-1 text-xs text-red-500"><CircleAlert className="h-3.5 w-3.5" />{item.error}</p> : null}
              {item.txHash ? <p className="mt-2 break-all font-mono text-[11px] text-green-500">{item.txHash}</p> : null}
            </article>
          ))}
        </div>

        <footer className="border-t border-border p-5">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Estimated total</span>
            <span className="font-semibold">{totalAmount.toFixed(2)} USDC</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={clearCompleted}
              disabled={!items.some((item) => item.status === 'confirmed') || isExecuting}
              className="rounded-lg border border-border px-3 text-xs hover:bg-secondary disabled:opacity-40"
            >
              Clear completed
            </button>
            <button
              type="button"
              onClick={run}
              disabled={isExecuting || items.length === 0 || items.every((item) => item.status === 'confirmed')}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {isExecuting ? <Loader className="h-4 w-4 animate-spin" /> : itemActionIcon(isExecuting)}
              {isExecuting ? 'Submitting…' : 'Submit positions'}
            </button>
          </div>
          <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Check className="h-3.5 w-3.5" /> Each position is confirmed before the next one starts.
          </p>
        </footer>
      </aside>
    </div>
  );
}

function itemActionIcon(isExecuting: boolean) {
  return isExecuting ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />;
}
