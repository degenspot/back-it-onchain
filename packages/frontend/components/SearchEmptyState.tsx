import { EmptyState } from './EmptyState';

/** Empty state for search when nothing matches the query (FE-25). */
export function SearchEmptyState({ query }: { query?: string }) {
  return (
    <EmptyState
      title={`No results${query ? ` for “${query}”` : ''}`}
      description="Try a different market name, token, or creator."
    />
  );
}
