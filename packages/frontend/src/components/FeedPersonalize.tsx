'use client';

import * as React from 'react';
import { useFeedPrefs, type FeedPrefs } from '@/src/hooks/useFeedPrefs';
import { cn } from '@/lib/utils';

/**
 * Feed personalization panel (FE-30): mute authors, filter chains, and tune
 * ranking weights.
 */
export function FeedPersonalize() {
  const { prefs, setPrefs, resetPrefs } = useFeedPrefs();

  const toggleChain = (chain: FeedPrefs['chains'][number]) => {
    const hasAll = prefs.chains.includes('all');
    if (chain === 'all') {
      setPrefs({ chains: hasAll ? [] : ['all'] });
      return;
    }
    const withoutAll = prefs.chains.filter((c) => c !== 'all');
    const next = withoutAll.includes(chain)
      ? withoutAll.filter((c) => c !== chain)
      : [...withoutAll, chain];
    setPrefs({ chains: next.length === 0 ? ['all'] : next });
  };

  const setWeight = (key: keyof FeedPrefs['weights'], value: number) => {
    setPrefs({ weights: { ...prefs.weights, [key]: value } });
  };

  const removeMuted = (author: string) => {
    setPrefs({ mutedAuthors: prefs.mutedAuthors.filter((m) => m !== author) });
  };

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border border-border bg-card/50 p-4"
      data-testid="feed-personalize"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Feed settings</h3>
        <button
          type="button"
          onClick={resetPrefs}
          className="text-xs text-muted-foreground hover:text-foreground"
          data-testid="personalize-reset"
        >
          Reset
        </button>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Chains</legend>
        <div className="flex flex-wrap gap-2">
          {(['all', 'base', 'stellar'] as const).map((chain) => {
            const active = prefs.chains.includes(chain);
            return (
              <button
                key={chain}
                type="button"
                onClick={() => toggleChain(chain)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/20 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:bg-secondary/40',
                )}
              >
                {chain}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Ranking weights</legend>
        {(
          [
            ['stake', 'Stake size'],
            ['acumen', 'Tracker accuracy'],
            ['recency', 'Recency'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="mb-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{label}</span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.5}
              value={prefs.weights[key]}
              onChange={(e) => setWeight(key, Number(e.target.value))}
              className="w-32 accent-primary"
              aria-label={`${label} weight`}
            />
          </label>
        ))}
      </fieldset>

      {prefs.mutedAuthors.length > 0 ? (
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted-foreground">
            Muted ({prefs.mutedAuthors.length})
          </legend>
          <ul className="flex flex-col gap-1">
            {prefs.mutedAuthors.map((author) => (
              <li key={author} className="flex items-center justify-between text-sm">
                <span className="truncate text-muted-foreground">{author}</span>
                <button
                  type="button"
                  onClick={() => removeMuted(author)}
                  className="text-xs text-destructive hover:underline"
                >
                  Unmute
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
    </div>
  );
}
