import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FeedList } from './FeedList';
import React from 'react';

// Mock CallCard and CallCardSkeleton to avoid deep rendering issues
vi.mock('@/components/CallCard', () => ({
    CallCard: ({ call }: any) => <div data-testid={`call-card-${call.id}`}>{call.tokenAddress}</div>
}));

vi.mock('@/components/CallCardSkeleton', () => ({
    CallCardSkeleton: () => <div data-testid="call-skeleton" />
}));

describe('FeedList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should show loading state initially', () => {
        // Mock fetch to stay pending
        global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
        
        render(<FeedList fetchUrl="/test-api" />);
        expect(screen.getByTestId('feed-loading')).toBeInTheDocument();
        expect(screen.getAllByTestId('call-skeleton').length).toBeGreaterThan(0);
    });

    it('should render calls when fetch is successful', async () => {
        const mockCalls = [
            { id: 1, tokenAddress: '0x123', chain: 'base' },
            { id: 2, tokenAddress: '0x456', chain: 'stellar' }
        ];
        
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockCalls
        });

        render(<FeedList fetchUrl="/test-api" />);

        await waitFor(() => {
            expect(screen.getByTestId('call-card-1')).toBeInTheDocument();
            expect(screen.getByTestId('call-card-2')).toBeInTheDocument();
        });
    });

    it('should show empty state when no calls are returned', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => []
        });

        render(<FeedList fetchUrl="/test-api" />);

        await waitFor(() => {
            expect(screen.getByTestId('feed-empty')).toBeInTheDocument();
            expect(screen.getByText(/No calls found/i)).toBeInTheDocument();
        });
    });

    it('should show error state when fetch fails', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false
        });

        render(<FeedList fetchUrl="/test-api" />);

        await waitFor(() => {
            expect(screen.getByTestId('feed-error')).toBeInTheDocument();
            expect(screen.getByText(/Failed to fetch calls/i)).toBeInTheDocument();
        });
    });
});
