import React from 'react';
import { type Call } from '../../lib/types';

export interface FeedListProps {
  isLoading?: boolean;
  calls?: Call[];
}

export function FeedList({ isLoading, calls = [] }: FeedListProps) {
  if (isLoading) {
    return <div data-testid="loading-state">Loading...</div>;
  }

  if (!calls || calls.length === 0) {
    return <div data-testid="empty-state">No calls found</div>;
  }

  return (
    <div data-testid="feed-list">
      {calls.map((call, index) => (
        <div key={call.id || index} data-testid="call-card">
          {call.title}
        </div>
      ))}
    </div>
  );
}
