"use client";

import React, { useEffect, useRef } from 'react';
import { type Call } from '../lib/types';

export default function StakingModal({ open, call, onClose }: { open: boolean; call: Call | null; onClose: () => void }) {
  const [amount, setAmount] = React.useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Remember which element opened the modal so we can restore focus on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
    } else {
      // Restore focus to the trigger when the modal closes.
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    }
  }, [open]);

  // Focus the dialog when it opens.
  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Trap focus within the dialog.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;

      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  if (!open || !call) return null;

  const title = call.conditionJson?.title || call.title || 'Stake';
  const titleId = 'staking-modal-title';
  const descId = 'staking-modal-desc';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      ref={dialogRef}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-card rounded-lg p-6 w-full max-w-md shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h3 id={titleId} className="text-lg font-bold">{title}</h3>
          <button
            ref={closeButtonRef}
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <div className="mb-3">
          <div className="text-sm text-muted-foreground">Market</div>
          <div className="font-bold">{title}</div>
        </div>
        <div className="mb-4">
          <label htmlFor="staking-amount" className="text-sm text-muted-foreground block mb-1">
            Amount ({call.stakeToken || 'TOKEN'})
          </label>
          <input
            id="staking-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full mt-2 px-3 py-2 rounded-md border border-border bg-transparent"
            placeholder="0.00"
            aria-describedby={descId}
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-md bg-secondary">Cancel</button>
          <button onClick={() => { /* TODO: wire staking call */ onClose(); }} className="px-4 py-2 rounded-md bg-primary text-white">Stake</button>
        </div>
        <p id={descId} className="sr-only">Enter the amount you would like to stake on this market.</p>
      </div>
    </div>
  );
}
