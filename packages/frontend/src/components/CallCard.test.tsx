import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { CallCard } from '../../components/CallCard';

// Mock next/link
vi.mock('next/link', () => {
  return {
    default: ({ children, href }: any) => {
      return <a href={href}>{children}</a>;
    }
  };
});

describe('CallCard Component', () => {
  const mockCall = {
    id: 'call-123',
    title: 'Bitcoin ETF Approval',
    conditionJson: {
      title: 'Bitcoin ETF Approval by Q1 2024',
    },
    status: 'active',
    chain: 'base',
    creator: {
      displayName: 'John Predictor',
      wallet: '0x1234567890abcdef',
    },
    creatorWallet: '0x1234567890abcdef',
    createdAt: '2024-01-15T10:00:00Z',
    endTs: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    stakeToken: 'USDC',
    totalStakeYes: '5000',
    totalStakeNo: '3000',
    comments: 12,
    backers: 25,
  };

  describe('Title Rendering', () => {
    it('should render call title from conditionJson if available', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText('Bitcoin ETF Approval by Q1 2024')).toBeInTheDocument();
    });

    it('should render call title from title prop as fallback', () => {
      const callWithoutCondition = {
        ...mockCall,
        conditionJson: undefined,
      };
      render(<CallCard call={callWithoutCondition} />);
      expect(screen.getByText('Bitcoin ETF Approval')).toBeInTheDocument();
    });

    it('should display "Untitled Call" when no title is provided', () => {
      const callWithoutTitle = {
        ...mockCall,
        title: undefined,
        conditionJson: undefined,
      };
      render(<CallCard call={callWithoutTitle} />);
      expect(screen.getByText('Untitled Call')).toBeInTheDocument();
    });

    it('should display title with correct styling', () => {
      render(<CallCard call={mockCall} />);
      const titleElement = screen.getByText('Bitcoin ETF Approval by Q1 2024');
      expect(titleElement).toHaveClass('text-lg', 'font-bold');
    });
  });

  describe('Price/Pool Display', () => {
    it('should display stake token and pool label', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText('USDC Pool')).toBeInTheDocument();
    });

    it('should display YES stake amount', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText('5000')).toBeInTheDocument();
      expect(screen.getByText(/YES/)).toBeInTheDocument();
    });

    it('should display NO stake amount', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText('3000')).toBeInTheDocument();
      expect(screen.getByText(/NO/)).toBeInTheDocument();
    });

    it('should calculate and display total pool correctly', () => {
      render(<CallCard call={mockCall} />);
      const poolText = screen.getByText(/Pool: 8000/);
      expect(poolText).toBeInTheDocument();
    });

    it('should handle zero stake amounts', () => {
      const callWithZeroStakes = {
        ...mockCall,
        totalStakeYes: '0',
        totalStakeNo: '0',
      };
      render(<CallCard call={callWithZeroStakes} />);
      expect(screen.getByText(/Pool: 0/)).toBeInTheDocument();
    });

    it('should handle missing stake amounts gracefully', () => {
      const callWithoutStakes = {
        ...mockCall,
        totalStakeYes: undefined,
        totalStakeNo: undefined,
      };
      render(<CallCard call={callWithoutStakes} />);
      expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    });

    it('should display YES in green color', () => {
      const { container } = render(<CallCard call={mockCall} />);
      const yesSpan = Array.from(container.querySelectorAll('span')).find(
        (el) => el.textContent === '5000'
      );
      expect(yesSpan).toHaveClass('text-green-500');
    });

    it('should display NO in red color', () => {
      const { container } = render(<CallCard call={mockCall} />);
      const noSpan = Array.from(container.querySelectorAll('span')).find(
        (el) => el.textContent === '3000'
      );
      expect(noSpan).toHaveClass('text-red-500');
    });
  });

  describe('End Date/Time Remaining Display', () => {
    it('should display countdown for calls happening in the future', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText(/Ends in \d+[dhm]/)).toBeInTheDocument();
    });

    it('should display "Ended" when deadline has passed', () => {
      const passedCall = {
        ...mockCall,
        endTs: new Date(Date.now() - 1000).toISOString(),
      };
      render(<CallCard call={passedCall} />);
      expect(screen.getByText('Ended')).toBeInTheDocument();
    });

    it('should display time in minutes when less than 60 minutes remain', () => {
      const shortTimeCall = {
        ...mockCall,
        endTs: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
      };
      render(<CallCard call={shortTimeCall} />);
      const timeText = screen.getByText(/Ends in \d+m/);
      expect(timeText).toBeInTheDocument();
    });

    it('should display time in hours when less than 24 hours remain', () => {
      const mediumTimeCall = {
        ...mockCall,
        endTs: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), // 5 hours
      };
      render(<CallCard call={mediumTimeCall} />);
      const timeText = screen.getByText(/Ends in \d+h/);
      expect(timeText).toBeInTheDocument();
    });

    it('should display time in days when more than 24 hours remain', () => {
      const longTimeCall = {
        ...mockCall,
        endTs: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days
      };
      render(<CallCard call={longTimeCall} />);
      const timeText = screen.getByText(/Ends in \d+d/);
      expect(timeText).toBeInTheDocument();
    });
  });

  describe('Stake Button Visibility & Interaction', () => {
    it('should render Quick Stake button', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText('Quick Stake')).toBeInTheDocument();
    });

    it('should show Quick Stake button on hover', () => {
      const { container } = render(<CallCard call={mockCall} />);
      const button = screen.getByText('Quick Stake');
      expect(button).toBeInTheDocument();
      expect(button.parentElement).toHaveClass('opacity-0', 'group-hover:opacity-100');
    });

    it('should dispatch custom event on Quick Stake button click', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
      render(<CallCard call={mockCall} />);
      
      const stakeButton = screen.getByText('Quick Stake');
      fireEvent.click(stakeButton);
      
      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'quick-stake',
        })
      );
      
      dispatchEventSpy.mockRestore();
    });

    it('should prevent default and stop propagation on Quick Stake click', () => {
      render(<CallCard call={mockCall} />);
      const stakeButton = screen.getByText('Quick Stake');
      
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');
      
      fireEvent(stakeButton, event);
      
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
      
      preventDefaultSpy.mockRestore();
      stopPropagationSpy.mockRestore();
    });

    it('should have correct styling for Quick Stake button', () => {
      render(<CallCard call={mockCall} />);
      const stakeButton = screen.getByText('Quick Stake');
      expect(stakeButton).toHaveClass('bg-primary', 'text-white', 'text-sm');
    });

    it('should display Quick Stake button for active calls', () => {
      const activeCall = {
        ...mockCall,
        status: 'active',
      };
      render(<CallCard call={activeCall} />);
      expect(screen.getByText('Quick Stake')).toBeInTheDocument();
    });
  });

  describe('Card Layout & Basic Display', () => {
    it('should render card as a link to the call details page', () => {
      const { container } = render(<CallCard call={mockCall} />);
      const link = container.querySelector('a[href="/calls/call-123"]');
      expect(link).toBeInTheDocument();
    });

    it('should display creator display name', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText('John Predictor')).toBeInTheDocument();
    });

    it('should display creator wallet as fallback', () => {
      const callWithoutDisplayName = {
        ...mockCall,
        creator: {
          wallet: '0xabc123',
        },
      };
      render(<CallCard call={callWithoutDisplayName} />);
      expect(screen.getByText('0xabc')).toBeInTheDocument();
    });

    it('should display call creation date', () => {
      render(<CallCard call={mockCall} />);
      const dateText = new Date(mockCall.createdAt).toLocaleDateString();
      expect(screen.getByText(dateText)).toBeInTheDocument();
    });

    it('should display status badge', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText('active')).toBeInTheDocument();
    });

    it('should display comments count', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText('12 Comments')).toBeInTheDocument();
    });

    it('should handle zero comments', () => {
      const callWithoutComments = {
        ...mockCall,
        comments: 0,
      };
      render(<CallCard call={callWithoutComments} />);
      expect(screen.getByText('0 Comments')).toBeInTheDocument();
    });
  });

  describe('Chain Badge Display', () => {
    it('should display Base chain badge', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText('Base')).toBeInTheDocument();
    });

    it('should display Stellar chain badge', () => {
      const stellarCall = {
        ...mockCall,
        chain: 'stellar',
      };
      render(<CallCard call={stellarCall} />);
      expect(screen.getByText('Stellar')).toBeInTheDocument();
    });

    it('should default to Base chain when not specified', () => {
      const callWithoutChain = {
        ...mockCall,
        chain: undefined,
      };
      render(<CallCard call={callWithoutChain} />);
      expect(screen.getByText('Base')).toBeInTheDocument();
    });
  });

  describe('Explorer Link', () => {
    it('should render View on Explorer link', () => {
      render(<CallCard call={mockCall} />);
      expect(screen.getByText(/View on Explorer/)).toBeInTheDocument();
    });

    it('should link to correct Base Sepolia explorer URL', () => {
      render(<CallCard call={mockCall} />);
      const explorerLink = screen.getByText(/View on Explorer/).closest('a');
      expect(explorerLink).toHaveAttribute(
        'href',
        'https://basescan.org/address/0x1234567890abcdef'
      );
    });

    it('should link to correct Stellar explorer URL', () => {
      const stellarCall = {
        ...mockCall,
        chain: 'stellar',
      };
      render(<CallCard call={stellarCall} />);
      const explorerLink = screen.getByText(/View on Explorer/).closest('a');
      expect(explorerLink).toHaveAttribute(
        'href',
        'https://stellar.expert/explorer/public/account/0x1234567890abcdef'
      );
    });

    it('should open explorer in new tab', () => {
      render(<CallCard call={mockCall} />);
      const explorerLink = screen.getByText(/View on Explorer/).closest('a');
      expect(explorerLink).toHaveAttribute('target', '_blank');
      expect(explorerLink).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('Report Functionality', () => {
    it('should render more options button', () => {
      render(<CallCard call={mockCall} />);
      const moreButton = screen.getByLabelText('More options');
      expect(moreButton).toBeInTheDocument();
    });

    it('should show Report Call option when more menu is clicked', async () => {
      render(<CallCard call={mockCall} />);
      const moreButton = screen.getByLabelText('More options');
      
      fireEvent.click(moreButton);
      
      await waitFor(() => {
        expect(screen.getByText('Report Call')).toBeInTheDocument();
      });
    });

    it('should display report modal when Report Call is clicked', async () => {
      render(<CallCard call={mockCall} />);
      const moreButton = screen.getByLabelText('More options');
      
      fireEvent.click(moreButton);
      
      await waitFor(() => {
        const reportButton = screen.getByText('Report Call');
        fireEvent.click(reportButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Report Content')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Reason for reporting...')).toBeInTheDocument();
      });
    });

    it('should close modal when Cancel is clicked', async () => {
      render(<CallCard call={mockCall} />);
      const moreButton = screen.getByLabelText('More options');
      
      fireEvent.click(moreButton);

      await waitFor(() => {
        const reportButton = screen.getByText('Report Call');
        fireEvent.click(reportButton);
      });

      await waitFor(() => {
        const cancelButton = screen.getByText('Cancel');
        fireEvent.click(cancelButton);
      });

      await waitFor(() => {
        expect(screen.queryByText('Report Content')).not.toBeInTheDocument();
      });
    });
  });

  describe('Hot Market Detection & Animation', () => {
    it('should apply pulse animation for hot markets (pool >= 100)', () => {
      const hotCall = {
        ...mockCall,
        totalStakeYes: '60',
        totalStakeNo: '50',
      };
      const { container } = render(<CallCard call={hotCall} />);
      const cardDiv = container.querySelector('.animate-pulse');
      expect(cardDiv).toBeInTheDocument();
    });

    it('should not apply pulse animation for cold markets (pool < 100)', () => {
      const coldCall = {
        ...mockCall,
        totalStakeYes: '30',
        totalStakeNo: '20',
      };
      const { container } = render(<CallCard call={coldCall} />);
      const cardDiv = container.querySelector('.animate-pulse');
      expect(cardDiv).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases & Error Handling', () => {
    it('should handle missing creator information gracefully', () => {
      const callWithoutCreator = {
        ...mockCall,
        creator: undefined,
      };
      expect(() => {
        render(<CallCard call={callWithoutCreator} />);
      }).not.toThrow();
    });

    it('should handle very large stake amounts', () => {
      const callWithLargeStakes = {
        ...mockCall,
        totalStakeYes: '999999999999',
        totalStakeNo: '888888888888',
      };
      render(<CallCard call={callWithLargeStakes} />);
      expect(screen.getByText('999999999999')).toBeInTheDocument();
      expect(screen.getByText('888888888888')).toBeInTheDocument();
    });

    it('should handle call with very long title', () => {
      const longTitle = 'A'.repeat(200);
      const callWithLongTitle = {
        ...mockCall,
        conditionJson: {
          title: longTitle,
        },
      };
      render(<CallCard call={callWithLongTitle} />);
      expect(screen.getByText(longTitle)).toBeInTheDocument();
    });

    it('should handle missing endTs gracefully', () => {
      const callWithoutEndTs = {
        ...mockCall,
        endTs: undefined,
      };
      expect(() => {
        render(<CallCard call={callWithoutEndTs} />);
      }).not.toThrow();
    });

    it('should handle null stake token', () => {
      const callWithoutToken = {
        ...mockCall,
        stakeToken: undefined,
      };
      render(<CallCard call={callWithoutToken} />);
      expect(screen.getAllByText(/Pool/).length).toBeGreaterThan(0);
    });
  });
});
