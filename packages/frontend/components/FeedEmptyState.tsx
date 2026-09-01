import Link from 'next/link';
import { EmptyState } from './EmptyState';

/** Empty state for the feed when there are no calls to show (FE-25). */
export function FeedEmptyState() {
  return (
    <EmptyState
      title="No markets yet"
      description="Be the first to create a market and put your prediction on the line."
      action={
        <Link
          href="/create"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          Create a market
        </Link>
      }
    />
  );
}
