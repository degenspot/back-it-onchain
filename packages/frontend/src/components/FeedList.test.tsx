/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { FeedList } from './FeedList';

// Mock CallCard since we only want to test FeedList rendering logic
vi.mock('./CallCard', () => {
  return {
    CallCard: ({ call }: { call: any }) => (
      <div data-testid="call-card">{call.title}</div>
    ),
  };
});

describe('FeedList Component', () => {
  const mockCalls = [
    { id: '1', title: 'Bitcoin to 100k' },
    { id: '2', title: 'Ethereum 2.0' },
  ];

  it('renders loading state when isLoading is true', () => {
    render(<FeedList isLoading={true} />);
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
  });

  it('renders empty state when there are no calls', () => {
    render(<FeedList isLoading={false} calls={[]} />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No calls found')).toBeInTheDocument();
  });

  it('renders a list of CallCards when calls are provided', () => {
    render(<FeedList isLoading={false} calls={mockCalls as any} />);
    const callCards = screen.getAllByTestId('call-card');
    expect(callCards).toHaveLength(2);
    expect(screen.getByText('Bitcoin to 100k')).toBeInTheDocument();
    expect(screen.getByText('Ethereum 2.0')).toBeInTheDocument();
  });
});
