import { describe, it, expect } from 'vitest';
import { applyFeedPrefs, type FeedPrefs } from './useFeedPrefs';
import type { Call } from '../../lib/types';

const DEFAULTS: FeedPrefs = {
  mutedAuthors: [],
  chains: ['all'],
  weights: { stake: 1, acumen: 1, recency: 1 },
};

function call(id: string, opts: Partial<Call> = {}): Call {
  return { id, title: `Call ${id}`, ...opts };
}

describe('applyFeedPrefs', () => {
  it('keeps the feed untouched with default prefs', () => {
    const calls = [call('1'), call('2')];

    expect(applyFeedPrefs(calls, DEFAULTS)).toEqual(calls);
  });

  it('drops calls from muted authors', () => {
    const a = call('1', { creatorWallet: '0xA', creator: { wallet: '0xA' } });
    const b = call('2', { creatorWallet: '0xB', creator: { wallet: '0xB' } });

    const result = applyFeedPrefs([a, b], { ...DEFAULTS, mutedAuthors: ['0xa'] });

    expect(result.map((c) => c.id)).toEqual(['2']);
  });

  it('drops calls whose token is muted', () => {
    const a = call('1', { tokenAddress: '0xTOKEN' });
    const b = call('2');

    const result = applyFeedPrefs([a, b], { ...DEFAULTS, mutedAuthors: ['0xtoken'] });

    expect(result.map((c) => c.id)).toEqual(['2']);
  });

  it('hides chains that are not selected', () => {
    const base = call('1', { chain: 'base' });
    const stellar = call('2', { chain: 'stellar' });

    const result = applyFeedPrefs([base, stellar], { ...DEFAULTS, chains: ['base'] });

    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('re-ranks by stake size when the stake weight is raised', () => {
    const small = call('1', { totalStakeYes: 10, totalStakeNo: 0 });
    const big = call('2', { totalStakeYes: 1000, totalStakeNo: 0 });

    const result = applyFeedPrefs([small, big], {
      ...DEFAULTS,
      weights: { stake: 3, acumen: 0, recency: 0 },
    });

    expect(result.map((c) => c.id)).toEqual(['2', '1']);
  });
});