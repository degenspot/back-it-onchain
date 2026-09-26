'use client';

import * as React from 'react';
import { reportWidgetError } from '@/src/lib/error-reporting';

export interface WidgetErrorBoundaryProps {
  /** Human-readable widget name, surfaced in the fallback and the report. */
  widget: string;
  /**
   * localStorage keys holding this widget's persisted state. A full reset
   * clears them so a crash caused by corrupt persisted state is recoverable
   * without the user clearing site data by hand.
   */
  stateKeys?: string[];
  /** Optional custom fallback. Receives a retry callback. */
  fallback?: (props: { error: Error; retry: () => void }) => React.ReactNode;
  children: React.ReactNode;
}

interface WidgetErrorBoundaryState {
  error: Error | null;
  /** Bumped on retry to force a fresh subtree rather than a reused one. */
  resetKey: number;
}

/**
 * Isolates a crash to a single widget (FE-041).
 *
 * Without this, one widget throwing takes down the whole route via the nearest
 * App Router boundary. Wrapping the critical widgets keeps the rest of the page
 * interactive and offers a local retry instead of a full reload.
 *
 * Must be a class component — React only exposes error catching through
 * `getDerivedStateFromError` / `componentDidCatch`.
 */
export class WidgetErrorBoundary extends React.Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  constructor(props: WidgetErrorBoundaryProps) {
    super(props);
    this.state = { error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<WidgetErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    reportWidgetError({
      widget: this.props.widget,
      error,
      componentStack: errorInfo?.componentStack ?? undefined,
      breadcrumbs: [
        `widget:${this.props.widget}`,
        `path:${typeof window !== 'undefined' ? window.location.pathname : 'ssr'}`,
      ],
    });
  }

  /** Re-mounts the subtree, keeping any persisted state. */
  retry = (): void => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  /** Clears this widget's persisted state, then re-mounts. */
  resetState = (): void => {
    const { stateKeys } = this.props;
    if (stateKeys?.length && typeof window !== 'undefined') {
      for (const key of stateKeys) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // Private mode or disabled storage — recovery should still proceed.
        }
      }
    }
    this.retry();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    const { widget, children, fallback, stateKeys } = this.props;

    if (!error) {
      return <React.Fragment key={this.state.resetKey}>{children}</React.Fragment>;
    }

    if (fallback) {
      return <>{fallback({ error, retry: this.retry })}</>;
    }

    return (
      <div
        role="alert"
        data-testid={`widget-error-${widget}`}
        className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card/50 p-6 text-center"
      >
        <p className="text-sm font-medium">{widget} couldn&apos;t load</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          The rest of the page is still usable. You can retry just this section.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={this.retry}
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Reload Widget
          </button>
          {stateKeys?.length ? (
            <button
              type="button"
              onClick={this.resetState}
              className="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
            >
              Reset &amp; Reload
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}

export default WidgetErrorBoundary;
