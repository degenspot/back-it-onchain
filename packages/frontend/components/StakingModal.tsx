"use client";

import React, { useState } from 'react';
import { type Call } from '../lib/types';

export default function StakingModal({ open, call, onClose }: { open: boolean; call: Call | null; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  if (!open || !call) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-lg p-6 w-full max-w-md shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Quick Stake</h3>
          <button className="text-muted-foreground" onClick={onClose}>Close</button>
        </div>
        <div className="mb-3">
          <div className="text-sm text-muted-foreground">Market</div>
          <div className="font-bold">{call.conditionJson?.title || call.title}</div>
        </div>
        <div className="mb-4">
          <label className="text-sm text-muted-foreground">Amount ({call.stakeToken || 'TOKEN'})</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full mt-2 px-3 py-2 rounded-md border border-border bg-transparent" placeholder="0.00" />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-md bg-secondary">Cancel</button>
          <button onClick={() => { /* TODO: wire staking call */ onClose(); }} className="px-4 py-2 rounded-md bg-primary text-white">Stake</button>
        </div>
      </div>
    </div>
  );
}
