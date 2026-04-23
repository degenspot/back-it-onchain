import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { ProfileHeader, User, SocialStats } from './ProfileHeader';

describe('ProfileHeader Component', () => {
  const mockUser: User = {
    wallet: '0x1234567890abcdef',
    displayName: 'John Doe',
    handle: '@johndoe',
    bio: 'A crypto enthusiast',
    avatar: 'bg-blue-500',
  };

  const mockSocialStats: SocialStats = {
    followersCount: 100,
    followingCount: 50,
  };

  describe('Rendering', () => {
    it('should render the component without crashing', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      expect(screen.getByTestId('user-avatar')).toBeInTheDocument();
    });

    it('should render the user avatar', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const avatar = screen.getByTestId('user-avatar');
      expect(avatar).toBeInTheDocument();
      expect(avatar).toHaveClass(mockUser.avatar as string);
    });
  });

  describe('User Stats Display', () => {
    it('should display followers count', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const followersCount = screen.getByTestId('followers-count');
      expect(followersCount).toHaveTextContent('100');
    });

    it('should display following count', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const followingCount = screen.getByTestId('following-count');
      expect(followingCount).toHaveTextContent('50');
    });

    it('should display "Followers" label', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const followersLabel = screen.getByTestId('followers-stat');
      expect(followersLabel).toHaveTextContent('Followers');
    });

    it('should display "Following" label', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const followingLabel = screen.getByTestId('following-stat');
      expect(followingLabel).toHaveTextContent('Following');
    });

    it('should display zero counts when stats are 0', () => {
      const zeroStats: SocialStats = {
        followersCount: 0,
        followingCount: 0,
      };
      render(
        <ProfileHeader user={mockUser} socialStats={zeroStats} />
      );
      expect(screen.getByTestId('followers-count')).toHaveTextContent('0');
      expect(screen.getByTestId('following-count')).toHaveTextContent('0');
    });

    it('should display large follower counts correctly', () => {
      const largeStats: SocialStats = {
        followersCount: 999999,
        followingCount: 888888,
      };
      render(
        <ProfileHeader user={mockUser} socialStats={largeStats} />
      );
      expect(screen.getByTestId('followers-count')).toHaveTextContent('999999');
      expect(screen.getByTestId('following-count')).toHaveTextContent('888888');
    });
  });

  describe('Profile Information Display', () => {
    it('should display user display name', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const displayName = screen.getByTestId('user-display-name');
      expect(displayName).toHaveTextContent('John Doe');
    });

    it('should display user handle', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const handle = screen.getByTestId('user-handle');
      expect(handle).toHaveTextContent('@johndoe');
    });

    it('should display user bio', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const bio = screen.getByTestId('user-bio');
      expect(bio).toHaveTextContent('A crypto enthusiast');
    });

    it('should display default bio when not provided', () => {
      const userWithoutBio: User = {
        wallet: '0x1234567890abcdef',
        displayName: 'Jane Doe',
        handle: '@janedoe',
      };
      render(
        <ProfileHeader user={userWithoutBio} socialStats={mockSocialStats} />
      );
      const bio = screen.getByTestId('user-bio');
      expect(bio).toHaveTextContent('No bio yet.');
    });

    it('should display wallet address when display name is not provided', () => {
      const userWithoutDisplayName: User = {
        wallet: '0xabcdef1234567890',
      };
      render(
        <ProfileHeader
          user={userWithoutDisplayName}
          socialStats={mockSocialStats}
        />
      );
      const displayName = screen.getByTestId('user-display-name');
      expect(displayName).toHaveTextContent('0xabcd');
    });
  });

  describe('Follow Status Display', () => {
    it('should display follower and following counts in correct sections', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const followersSection = screen.getByTestId('followers-stat');
      const followingSection = screen.getByTestId('following-stat');

      expect(followersSection).toContainElement(
        screen.getByTestId('followers-count')
      );
      expect(followingSection).toContainElement(
        screen.getByTestId('following-count')
      );
    });

    it('should display follower and following with correct styling', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const followersCount = screen.getByTestId('followers-count');
      const followingCount = screen.getByTestId('following-count');

      expect(followersCount).toHaveClass('font-bold');
      expect(followingCount).toHaveClass('font-bold');
    });
  });

  describe('Edit Profile Button', () => {
    it('should render the edit profile button', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const editButton = screen.getByTestId('edit-profile-button');
      expect(editButton).toBeInTheDocument();
      expect(editButton).toHaveTextContent('Edit Profile');
    });

    it('should call onEditProfile when button is clicked', () => {
      const mockOnEditProfile = vi.fn();
      render(
        <ProfileHeader
          user={mockUser}
          socialStats={mockSocialStats}
          onEditProfile={mockOnEditProfile}
        />
      );
      const editButton = screen.getByTestId('edit-profile-button');
      fireEvent.click(editButton);
      expect(mockOnEditProfile).toHaveBeenCalledTimes(1);
    });

    it('should handle missing onEditProfile callback gracefully', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const editButton = screen.getByTestId('edit-profile-button');
      expect(() => {
        fireEvent.click(editButton);
      }).not.toThrow();
    });
  });

  describe('Chain Information Display', () => {
    it('should display "Base Sepolia" by default', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const chainInfo = screen.getByTestId('chain-info');
      expect(chainInfo).toHaveTextContent('Base Sepolia');
    });

    it('should display "Stellar" when currentChain is stellar', () => {
      render(
        <ProfileHeader
          user={mockUser}
          socialStats={mockSocialStats}
          currentChain="stellar"
        />
      );
      const chainInfo = screen.getByTestId('chain-info');
      expect(chainInfo).toHaveTextContent('Stellar');
    });

    it('should display "Base Sepolia" when currentChain is base', () => {
      render(
        <ProfileHeader
          user={mockUser}
          socialStats={mockSocialStats}
          currentChain="base"
        />
      );
      const chainInfo = screen.getByTestId('chain-info');
      expect(chainInfo).toHaveTextContent('Base Sepolia');
    });
  });

  describe('Website and Join Date Display', () => {
    it('should display website link', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const websiteInfo = screen.getByTestId('website-info');
      expect(websiteInfo).toHaveTextContent('backit.xyz');
    });

    it('should display website link with correct href', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const websiteInfo = screen.getByTestId('website-info');
      const websiteLink = websiteInfo.querySelector('a');
      expect(websiteLink).toHaveAttribute('href', 'https://backit.xyz');
    });

    it('should display join date', () => {
      render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const joinDateInfo = screen.getByTestId('join-date-info');
      expect(joinDateInfo).toHaveTextContent('Joined Nov 2025');
    });
  });

  describe('Component Layout', () => {
    it('should have cover image at the top', () => {
      const { container } = render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const coverImage = container.querySelector('.h-32');
      expect(coverImage).toBeInTheDocument();
      expect(coverImage).toHaveClass('bg-gradient-to-r');
    });

    it('should position avatar with negative margin', () => {
      const { container } = render(
        <ProfileHeader user={mockUser} socialStats={mockSocialStats} />
      );
      const avatarContainer = container.querySelector('.-mt-12');
      expect(avatarContainer).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings in user fields', () => {
      const userWithEmptyStrings: User = {
        wallet: '0x1234567890abcdef',
        displayName: '',
        handle: '',
        bio: '',
      };
      render(
        <ProfileHeader
          user={userWithEmptyStrings}
          socialStats={mockSocialStats}
        />
      );
      expect(screen.getByTestId('user-display-name')).toBeInTheDocument();
    });

    it('should handle very long user names', () => {
      const userWithLongName: User = {
        wallet: '0x1234567890abcdef',
        displayName: 'A'.repeat(100),
        handle: '@' + 'b'.repeat(100),
      };
      render(
        <ProfileHeader
          user={userWithLongName}
          socialStats={mockSocialStats}
        />
      );
      expect(screen.getByTestId('user-display-name')).toBeInTheDocument();
    });

    it('should handle special characters in user info', () => {
      const userWithSpecialChars: User = {
        wallet: '0x1234567890abcdef',
        displayName: 'John "Crypto" Doe',
        handle: '@john_crypto-123',
        bio: 'Testing <special> & "characters"',
      };
      render(
        <ProfileHeader
          user={userWithSpecialChars}
          socialStats={mockSocialStats}
        />
      );
      expect(screen.getByTestId('user-display-name')).toHaveTextContent(
        'John "Crypto" Doe'
      );
      expect(screen.getByTestId('user-handle')).toHaveTextContent(
        '@john_crypto-123'
      );
    });
  });
});
