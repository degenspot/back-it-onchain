/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { auditA11y, formatViolations } from './axe-helper';
import { CallCard } from '../../components/CallCard';
import { PoolBar } from '../components/PoolBar';
import { SkipLink } from '../../components/SkipLink';
import { LiveRegion } from '../components/LiveRegion';
import { TokenSelector } from '../components/TokenSelector';
import { ParticipantList } from '../components/ParticipantList';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Call } from '../../lib/types';

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

const mockCall: Call = {
  id: 'call-123',
  title: 'Bitcoin ETF Approval',
  conditionJson: { title: 'Bitcoin ETF Approval by Q1 2024' },
  status: 'active',
  chain: 'base',
  creator: { displayName: 'John Predictor', wallet: '0x1234567890abcdef' },
  creatorWallet: '0x1234567890abcdef',
  createdAt: '2024-01-15T10:00:00Z',
  endTs: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  stakeToken: 'USDC',
  totalStakeYes: '5000',
  totalStakeNo: '3000',
  comments: 12,
  backers: 25,
} as Call;

/** Wraps a tree in the query client TokenSelector's data hook requires. */
function withQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

/** Asserts a rendered tree is free of WCAG 2.1 AA violations. */
async function expectNoViolations(container: HTMLElement) {
  const violations = await auditA11y(container);
  expect(formatViolations(violations)).toBe('no violations');
}

describe('WCAG 2.1 AA audit', () => {
  it('CallCard has no violations', async () => {
    const { container } = render(<CallCard call={mockCall as any} />);
    await expectNoViolations(container);
  });

  it('PoolBar has no violations', async () => {
    const { container } = render(<PoolBar pool={{ yesTotal: 5000, noTotal: 3000 }} />);
    await expectNoViolations(container);
  });

  it('SkipLink has no violations', async () => {
    const { container } = render(<SkipLink />);
    await expectNoViolations(container);
  });

  it('LiveRegion has no violations', async () => {
    const { container } = render(<LiveRegion message="Someone staked 100 USDC" />);
    await expectNoViolations(container);
  });

  it('TokenSelector has no violations', async () => {
    const { container } = render(withQueryClient(<TokenSelector />));
    await expectNoViolations(container);
  });

  it('ParticipantList has no violations', async () => {
    const { container } = render(
      <ParticipantList
        participants={[
          { wallet: '0x1234567890abcdef1234567890abcdef12345678', amount: 100, side: 'yes' },
          { wallet: '0xabcdef1234567890abcdef1234567890abcdef12', amount: 50, side: 'no' },
        ] as any}
      />,
    );
    await expectNoViolations(container);
  });

  it('ParticipantList loading state has no violations', async () => {
    const { container } = render(<ParticipantList participants={[]} loading />);
    await expectNoViolations(container);
  });

  it('PoolBar loading state has no violations', async () => {
    const { container } = render(<PoolBar pool={{ yesTotal: 0, noTotal: 0 }} loading />);
    await expectNoViolations(container);
  });
});

describe('keyboard operability', () => {
  it('exposes the skip link as a reachable anchor to main content', () => {
    const { container } = render(<SkipLink />);
    const link = container.querySelector('a[href="#main-content"]');
    expect(link).toBeTruthy();
    // Must not be removed from the tab order.
    expect(link?.getAttribute('tabindex')).not.toBe('-1');
  });

  it('gives every CallCard interactive element an accessible name', () => {
    const { container } = render(<CallCard call={mockCall as any} />);
    const interactive = container.querySelectorAll('button, a, [role="button"]');
    expect(interactive.length).toBeGreaterThan(0);
    for (const el of Array.from(interactive)) {
      const name =
        el.getAttribute('aria-label') ??
        el.getAttribute('title') ??
        el.textContent?.trim();
      expect(name, `element ${el.outerHTML.slice(0, 80)} has no accessible name`).toBeTruthy();
    }
  });
});

describe('LiveRegion', () => {
  it('announces politely without stealing focus', () => {
    const { container } = render(<LiveRegion message="Pool updated" />);
    const region = container.querySelector('[role="status"]');
    expect(region).toBeTruthy();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Pool updated');
  });

  it('supports assertive announcements for errors', () => {
    const { container } = render(<LiveRegion message="Stake failed" assertive />);
    const region = container.querySelector('[role="alert"]');
    expect(region).toBeTruthy();
    expect(region).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders an empty region when idle so the node is present for announcements', () => {
    const { container } = render(<LiveRegion message="" />);
    const region = container.querySelector('[role="status"]');
    expect(region).toBeTruthy();
    expect(region).toHaveTextContent('');
  });
});
