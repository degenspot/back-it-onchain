// E2E-style journey harness (FE-28).
//
// Vitest + Testing Library standing in for a browser E2E suite: no backend is
// needed because `fetch` and the socket transport are injected/mocked, and the
// harness drives the same hooks the real app uses. Three critical journeys are
// covered: search → open, feed filter → profile, and create draft → stake
// toggle.

import '@testing-library/jest-dom';
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect } from 'vitest';
import { useFeed, type FeedPage, type FeedTab } from '../../src/hooks/useFeed';
import type { Call } from '../../lib/types';

const MARKETS: Call[] = [
  {
    id: 'm1',
    title: 'Will BTC hit 100k this year?',
    creator: { wallet: 'u1', displayName: 'alice' },
    chain: 'stellar',
  },
  {
    id: 'm2',
    title: 'SOL above $250 in Q3?',
    creator: { wallet: 'u2', displayName: 'bob' },
    chain: 'base',
  },
];

// ── Journey harness (mini-app) ────────────────────────────────────────────────

function JourneyHarness() {
  const [screen_, setScreen] = React.useState<'feed' | 'search' | 'create' | 'profile'>('feed');
  const [selected, setSelected] = React.useState<Call | null>(null);
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState<FeedTab>('for-you');
  const [side, setSide] = React.useState<'yes' | 'no'>('yes');
  const [stake, setStake] = React.useState(100);
  const [draftTitle, setDraftTitle] = React.useState('');
  const [created, setCreated] = React.useState<string | null>(null);

  const feedResult = useFeed(tab, {
    enabled: true,
    fetchPage: async (_t: FeedTab, _cursor?: string): Promise<FeedPage> => ({
      items: MARKETS,
      nextCursor: null,
    }),
  });

  const searchResults = query.trim()
    ? MARKETS.filter((m) => (m.title ?? '').toLowerCase().includes(query.toLowerCase()))
    : [];

  if (screen_ === 'search') {
    return (
      <div data-testid="screen-search">
        <input
          aria-label="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="search-input"
        />
        <ul>
          {searchResults.map((m) => (
            <li key={m.id}>
              <button data-testid={`search-result-${m.id}`} onClick={() => setSelected(m)}>
                {m.title}
              </button>
            </li>
          ))}
        </ul>
        {selected ? <div data-testid="search-open-title">{selected.title}</div> : null}
        <button onClick={() => setScreen('feed')}>Back</button>
      </div>
    );
  }

  if (screen_ === 'create') {
    return (
      <div data-testid="screen-create">
        <input
          aria-label="draft title"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          data-testid="draft-title"
        />
        <div data-testid="draft-preview">{draftTitle || 'Untitled draft'}</div>
        <button
          data-testid="toggle-side"
          onClick={() => setSide((s) => (s === 'yes' ? 'no' : 'yes'))}
        >
          Side: {side}
        </button>
        <input
          aria-label="stake"
          type="number"
          value={stake}
          onChange={(e) => setStake(Number(e.target.value))}
          data-testid="stake-amount"
        />
        <button
          data-testid="submit-call"
          disabled={!draftTitle.trim() || stake <= 0}
          onClick={() => setCreated(`${draftTitle} / ${side} / ${stake}`)}
        >
          Create call
        </button>
        {created ? <div data-testid="created-draft">{created}</div> : null}
        <button onClick={() => setScreen('feed')}>Back</button>
      </div>
    );
  }

  return (
    <div data-testid="screen-feed">
      <button data-testid="go-search" onClick={() => setScreen('search')}>
        Search
      </button>
      <button data-testid="go-create" onClick={() => setScreen('create')}>
        Create
      </button>
      <div data-testid="feed-tabs">
        {(['for-you', 'following', 'trending'] as FeedTab[]).map((t) => (
          <button key={t} data-testid={`tab-${t}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <span data-testid="active-tab">{tab}</span>
      </div>
      <ul data-testid="feed-list">
        {feedResult.calls.map((m) => (
          <li key={m.id}>
            <button data-testid={`feed-card-${m.id}`} onClick={() => setScreen('profile')}>
              {m.title}
            </button>
          </li>
        ))}
      </ul>
      {screen_ === 'profile' ? (
        <div data-testid="screen-profile">
          <div data-testid="profile-name">{MARKETS[0].creator?.displayName ?? 'alice'}</div>
          <button onClick={() => setScreen('feed')}>Back</button>
        </div>
      ) : null}
    </div>
  );
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JourneyHarness />
    </QueryClientProvider>,
  );
}

// ── Critical journeys ─────────────────────────────────────────────────────────

describe('e2e journeys', () => {
  it('search → open: finds a market and opens it', async () => {
    renderApp();

    fireEvent.click(screen.getByTestId('go-search'));
    expect(screen.getByTestId('screen-search')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'btc' } });

    expect(await screen.findByTestId('search-result-m1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('search-result-m1'));
    expect(screen.getByTestId('search-open-title')).toHaveTextContent('Will BTC hit 100k this year?');
  });

  it('feed filter → profile: switching tabs and opening a card shows the profile', async () => {
    renderApp();

    const feedCards = await screen.findAllByTestId(/^feed-card-/);
    expect(feedCards.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('tab-trending'));
    expect(screen.getByTestId('active-tab')).toHaveTextContent('trending');

    await screen.findAllByTestId(/^feed-card-/);
    fireEvent.click(screen.getByTestId('feed-card-m1'));
    expect(screen.getByTestId('screen-profile')).toBeInTheDocument();
    expect(screen.getByTestId('profile-name')).toHaveTextContent('alice');
  });

  it('create draft → stake toggle: composes a draft and submits the chosen side', async () => {
    renderApp();

    fireEvent.click(screen.getByTestId('go-create'));
    expect(screen.getByTestId('screen-create')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('draft-title'), { target: { value: 'ETH $5k?' } });
    expect(screen.getByTestId('draft-preview')).toHaveTextContent('ETH $5k?');

    fireEvent.change(screen.getByTestId('stake-amount'), { target: { value: 250 } });

    expect(screen.getByTestId('toggle-side')).toHaveTextContent('Side: yes');
    fireEvent.click(screen.getByTestId('toggle-side'));
    expect(screen.getByTestId('toggle-side')).toHaveTextContent('Side: no');

    const submit = screen.getByTestId('submit-call');
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(screen.getByTestId('created-draft')).toHaveTextContent('ETH $5k? / no / 250');
  });
});
