import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import {
  setWidgetErrorSink,
  resetWidgetErrorSink,
  sanitizeErrorText,
  type WidgetErrorReport,
} from '../lib/error-reporting';

/** Throws on demand so a crash can be simulated and then recovered from. */
function Bomb({ explode, label = 'widget ok' }: { explode: boolean; label?: string }) {
  if (explode) throw new Error('widget exploded');
  return <div>{label}</div>;
}

describe('WidgetErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs caught errors; silence it so the suite output stays readable.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    resetWidgetErrorSink();
    window.localStorage.clear();
  });

  it('renders children when nothing throws', () => {
    render(
      <WidgetErrorBoundary widget="Feed">
        <Bomb explode={false} />
      </WidgetErrorBoundary>,
    );

    expect(screen.getByText('widget ok')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('isolates a crash to the failing widget and leaves siblings mounted', () => {
    render(
      <div>
        <WidgetErrorBoundary widget="Chart">
          <Bomb explode />
        </WidgetErrorBoundary>
        <WidgetErrorBoundary widget="Feed">
          <Bomb explode={false} label="feed still here" />
        </WidgetErrorBoundary>
        <div>page chrome</div>
      </div>,
    );

    // Failing widget shows its own fallback...
    expect(screen.getByTestId('widget-error-Chart')).toBeInTheDocument();
    expect(screen.getByText("Chart couldn't load")).toBeInTheDocument();

    // ...while the sibling widget and surrounding page are untouched.
    expect(screen.getByText('feed still here')).toBeInTheDocument();
    expect(screen.getByText('page chrome')).toBeInTheDocument();
  });

  it('recovers the widget when Reload Widget is pressed', () => {
    function Host() {
      const [explode, setExplode] = React.useState(true);
      return (
        <div>
          <button onClick={() => setExplode(false)}>fix it</button>
          <WidgetErrorBoundary widget="Staking Drawer">
            <Bomb explode={explode} label="drawer recovered" />
          </WidgetErrorBoundary>
        </div>
      );
    }

    render(<Host />);
    expect(screen.getByTestId('widget-error-Staking Drawer')).toBeInTheDocument();

    // Remove the cause, then retry — the subtree remounts and renders.
    fireEvent.click(screen.getByText('fix it'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload Widget' }));

    expect(screen.getByText('drawer recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears persisted widget state on Reset & Reload', () => {
    window.localStorage.setItem('feed:draft', 'corrupt');
    window.localStorage.setItem('unrelated', 'keep me');

    function Host() {
      const [explode, setExplode] = React.useState(true);
      return (
        <div>
          <button onClick={() => setExplode(false)}>fix it</button>
          <WidgetErrorBoundary widget="Feed" stateKeys={['feed:draft']}>
            <Bomb explode={explode} label="feed recovered" />
          </WidgetErrorBoundary>
        </div>
      );
    }

    render(<Host />);
    fireEvent.click(screen.getByText('fix it'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset & Reload' }));

    expect(window.localStorage.getItem('feed:draft')).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('keep me');
    expect(screen.getByText('feed recovered')).toBeInTheDocument();
  });

  it('offers no reset button when the widget persists no state', () => {
    render(
      <WidgetErrorBoundary widget="Header">
        <Bomb explode />
      </WidgetErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Reload Widget' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset & Reload' })).not.toBeInTheDocument();
  });

  it('reports the crash with the widget name and a component stack', () => {
    const reports: WidgetErrorReport[] = [];
    setWidgetErrorSink((r) => reports.push(r));

    render(
      <WidgetErrorBoundary widget="Feed">
        <Bomb explode />
      </WidgetErrorBoundary>,
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].widget).toBe('Feed');
    expect(reports[0].message).toBe('widget exploded');
    expect(reports[0].componentStack).toBeTruthy();
    expect(reports[0].breadcrumbs).toContain('widget:Feed');
  });

  it('redacts wallet material before a report leaves the boundary', () => {
    const reports: WidgetErrorReport[] = [];
    setWidgetErrorSink((r) => reports.push(r));

    function LeakyBomb(): React.ReactElement {
      throw new Error(
        'tx failed for 0x1234567890abcdef1234567890abcdef12345678 on account ' +
          'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      );
    }

    render(
      <WidgetErrorBoundary widget="Staking Drawer">
        <LeakyBomb />
      </WidgetErrorBoundary>,
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].message).not.toContain('0x1234567890abcdef1234567890abcdef12345678');
    expect(reports[0].message).toContain('[redacted]:evm-address');
  });

  it('does not escalate when the reporting sink itself throws', () => {
    setWidgetErrorSink(() => {
      throw new Error('sentry is down');
    });

    expect(() =>
      render(
        <WidgetErrorBoundary widget="Feed">
          <Bomb explode />
        </WidgetErrorBoundary>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId('widget-error-Feed')).toBeInTheDocument();
  });
});

describe('sanitizeErrorText', () => {
  it('redacts a Stellar secret seed before the public-key rule can match it', () => {
    const seed = 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
    const out = sanitizeErrorText(`signing failed with ${seed}`);
    expect(out).not.toContain(seed);
    expect(out).toContain('[redacted]:stellar-secret');
  });

  it('redacts EVM addresses and hex keys', () => {
    expect(sanitizeErrorText('from 0x1234567890abcdef1234567890abcdef12345678')).toContain(
      '[redacted]:evm-address',
    );
    expect(sanitizeErrorText(`key ${'a'.repeat(64)}`)).toContain('[redacted]:hex-key');
  });

  it('leaves ordinary messages untouched', () => {
    expect(sanitizeErrorText('network request failed')).toBe('network request failed');
  });

  it('returns an empty string for missing input', () => {
    expect(sanitizeErrorText(undefined)).toBe('');
    expect(sanitizeErrorText(null)).toBe('');
  });
});
