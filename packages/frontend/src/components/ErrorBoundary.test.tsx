import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/EmptyState';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom');
  return <div>ok</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('renders the fallback and resets on retry', () => {
    const onError = vi.fn();

    const { rerender } = render(
      <ErrorBoundary onError={onError}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary onError={onError}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.any(Object));
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();

    // Reset re-renders children.
    rerender(
      <ErrorBoundary onError={onError}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText('Try Again'));
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('supports a custom fallback render prop', () => {
    render(
      <ErrorBoundary fallback={(error) => <div data-testid="custom">{error.message}</div>}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom')).toHaveTextContent('boom');
  });
});

describe('Skeleton', () => {
  it('is aria-hidden and renders', () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders title, description and action', () => {
    render(
      <EmptyState
        title="Nothing here"
        description="Try again later"
        action={<button>Go</button>}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Try again later')).toBeInTheDocument();
    expect(screen.getByText('Go')).toBeInTheDocument();
  });
});
