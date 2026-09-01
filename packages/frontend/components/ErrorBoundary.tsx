'use client';

import * as React from 'react';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Fallback UI; if omitted a default panel is rendered. */
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  onError?: (error: Error, info: { componentStack: string | null }) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Reusable client-side error boundary (FE-25).
 *
 * Catches render errors from any subtree and shows a fallback instead of
 * tearing down the whole page. Works alongside Next.js route-level
 * `error.tsx` / `global-error.tsx` boundaries for per-component isolation.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, { componentStack: info.componentStack ?? null });
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;

    if (typeof fallback === 'function') {
      return fallback(error, this.handleReset);
    }

    if (fallback) return fallback;

    return (
      <div
        data-testid="error-boundary"
        className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center"
      >
        <p className="text-sm font-semibold text-destructive">Something went wrong</p>
        <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
        <button
          type="button"
          onClick={this.handleReset}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          Try Again
        </button>
      </div>
    );
  }
}
