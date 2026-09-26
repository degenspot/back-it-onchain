'use client';

import * as React from 'react';
import type { Call } from '../../lib/types';

export type SlipSide = 'back' | 'challenge';
export type SlipItemStatus = 'draft' | 'submitting' | 'confirmed' | 'failed';

export interface StakingSlipItem {
  id: string;
  callId: string;
  title: string;
  asset: string;
  side: SlipSide;
  amount: number;
  token: string;
  status: SlipItemStatus;
  error?: string;
  txHash?: string;
  createdAt: string;
}

export interface StakingSlipContextValue {
  items: StakingSlipItem[];
  isOpen: boolean;
  totalAmount: number;
  open: () => void;
  close: () => void;
  openWithCall: (call: Call, side?: SlipSide, amount?: number) => void;
  addItem: (call: Call, side?: SlipSide, amount?: number) => void;
  updateItem: (id: string, patch: Partial<Pick<StakingSlipItem, 'amount' | 'side'>>) => void;
  removeItem: (id: string) => void;
  clearCompleted: () => void;
  execute: (executor: (item: StakingSlipItem) => Promise<{ txHash?: string } | void>) => Promise<void>;
}

const STORAGE_KEY = 'backit-staking-slip-v1';
const StakingSlipContext = React.createContext<StakingSlipContextValue | null>(null);

function normalizeItem(item: StakingSlipItem): StakingSlipItem {
  return {
    ...item,
    amount: Number.isFinite(item.amount) ? Math.max(0, item.amount) : 0,
    status: item.status === 'submitting' ? 'draft' : item.status,
  };
}

function readItems(): StakingSlipItem[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StakingSlipItem[]) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeItem) : [];
  } catch {
    return [];
  }
}

function writeItems(items: StakingSlipItem[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function makeItem(call: Call, side: SlipSide, amount: number): StakingSlipItem {
  return {
    id: `${String(call.id)}:${side}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    callId: String(call.id),
    title: call.title || call.conditionJson?.title || 'Untitled call',
    asset: call.asset || 'Unknown market',
    side,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 25,
    token: call.stakeToken || 'USDC',
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
}

export function StakingSlipProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<StakingSlipItem[]>(readItems);
  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    writeItems(items);
  }, [items]);

  const addItem = React.useCallback((call: Call, side: SlipSide = 'back', amount = 25) => {
    setItems((current) => {
      const existing = current.find(
        (item) => item.callId === String(call.id) && item.side === side && item.status !== 'confirmed',
      );
      if (existing) {
        return current.map((item) =>
          item.id === existing.id ? { ...item, amount: Math.max(0, amount), status: 'draft', error: undefined } : item,
        );
      }
      return [...current, makeItem(call, side, amount)];
    });
    setIsOpen(true);
  }, []);

  const updateItem = React.useCallback(
    (id: string, patch: Partial<Pick<StakingSlipItem, 'amount' | 'side'>>) => {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          return {
            ...item,
            ...patch,
            amount: patch.amount === undefined ? item.amount : Math.max(0, patch.amount),
            status: 'draft',
            error: undefined,
          };
        }),
      );
    },
    [],
  );

  const removeItem = React.useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearCompleted = React.useCallback(() => {
    setItems((current) => current.filter((item) => item.status !== 'confirmed'));
  }, []);

  const execute = React.useCallback(
    async (executor: (item: StakingSlipItem) => Promise<{ txHash?: string } | void>) => {
      const pending = items.filter((item) => item.status !== 'confirmed');
      for (const item of pending) {
        setItems((current) => current.map((entry) => (
          entry.id === item.id ? { ...entry, status: 'submitting', error: undefined } : entry
        )));
        try {
          const result = await executor(item);
          setItems((current) => current.map((entry) => (
            entry.id === item.id
              ? { ...entry, status: 'confirmed', txHash: result?.txHash }
              : entry
          )));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Transaction was not submitted';
          setItems((current) => current.map((entry) => (
            entry.id === item.id ? { ...entry, status: 'failed', error: message } : entry
          )));
        }
      }
    },
    [items],
  );

  const value = React.useMemo<StakingSlipContextValue>(
    () => ({
      items,
      isOpen,
      totalAmount: items.reduce((total, item) => total + item.amount, 0),
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      openWithCall: (call, side, amount) => addItem(call, side, amount),
      addItem,
      updateItem,
      removeItem,
      clearCompleted,
      execute,
    }),
    [addItem, clearCompleted, execute, isOpen, items, removeItem, updateItem],
  );

  return <StakingSlipContext.Provider value={value}>{children}</StakingSlipContext.Provider>;
}

export function useStakingSlip(): StakingSlipContextValue {
  const context = React.useContext(StakingSlipContext);
  if (!context) throw new Error('useStakingSlip must be used inside StakingSlipProvider');
  return context;
}
