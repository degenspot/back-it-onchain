import { EmptyState } from './EmptyState';

/** Empty state for a profile with no joined markets (FE-25). */
export function ProfileEmptyState() {
  return (
    <EmptyState
      title="No activity yet"
      description="Once this user creates or joins markets, their activity will appear here."
    />
  );
}
