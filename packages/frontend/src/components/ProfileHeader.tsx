'use client';

import { User as UserIcon, MapPin, Calendar, Link as LinkIcon, Settings } from 'lucide-react';
import React from 'react';
import { formatJoinedDate } from '../../lib/utils';

export interface User {
  wallet: string;
  displayName?: string;
  handle?: string;
  bio?: string;
  avatar?: string;
  createdAt?: string | Date;
}

export interface SocialStats {
  followersCount: number;
  followingCount: number;
}

interface ProfileHeaderProps {
  user: User;
  socialStats: SocialStats;
  currentChain?: 'stellar' | 'base';
  onEditProfile?: () => void;
}

export function ProfileHeader({
  user,
  socialStats,
  currentChain = 'base',
  onEditProfile,
}: ProfileHeaderProps) {
  const displayName = user.displayName || user.wallet.slice(0, 6);
  const chainName = currentChain === 'stellar' ? 'Stellar' : 'Base Sepolia';
  const joinedDateLabel = formatJoinedDate(user.createdAt);

  return (
    <div className="w-full">
      {/* Cover Image */}
      <div className="h-32 bg-gradient-to-r from-primary/20 to-accent/20" />

      <div className="px-4 pb-4">
        {/* Profile Header with Avatar and Edit Button */}
        <div className="relative -mt-12 mb-4 flex justify-between items-end">
          <div className="h-24 w-24 rounded-full bg-background p-1">
            <div
              className={`h-full w-full rounded-full ${
                user.avatar || 'bg-muted'
              } flex items-center justify-center border border-border`}
              data-testid="user-avatar"
            >
              <UserIcon className="h-10 w-10 text-white" />
            </div>
          </div>
          <button
            data-testid="edit-profile-button"
            onClick={onEditProfile}
            className="px-4 py-2 rounded-full border border-border hover:bg-secondary transition-colors font-medium text-sm flex items-center gap-2"
          >
            <Settings className="h-4 w-4" />
            Edit Profile
          </button>
        </div>

        {/* User Information Section */}
        <div className="mb-6">
          <h1
            data-testid="user-display-name"
            className="text-2xl font-bold"
          >
            {displayName}
          </h1>
          <p data-testid="user-handle" className="text-muted-foreground">
            {user.handle}
          </p>

          <p data-testid="user-bio" className="mt-3 text-sm leading-relaxed">
            {user.bio || 'No bio yet.'}
          </p>

          {/* Stats: Location, Website, Join Date */}
          <div className="flex flex-wrap gap-4 mt-4 text-xs text-muted-foreground">
            <div
              className="flex items-center gap-1"
              data-testid="chain-info"
            >
              <MapPin className="h-3 w-3" />
              {chainName}
            </div>
            <div
              className="flex items-center gap-1"
              data-testid="website-info"
            >
              <LinkIcon className="h-3 w-3" />
              <a
                href="https://backit.xyz"
                className="hover:text-primary hover:underline"
              >
                backit.xyz
              </a>
            </div>
            {joinedDateLabel && (
              <div
                className="flex items-center gap-1"
                data-testid="join-date-info"
              >
                <Calendar className="h-3 w-3" />
                {joinedDateLabel}
              </div>
            )}
          </div>

          {/* Follow Stats */}
          <div className="flex gap-4 mt-4 text-sm">
            <div
              className="flex gap-1"
              data-testid="following-stat"
            >
              <span className="font-bold" data-testid="following-count">
                {socialStats.followingCount}
              </span>
              <span className="text-muted-foreground">Following</span>
            </div>
            <div
              className="flex gap-1"
              data-testid="followers-stat"
            >
              <span className="font-bold" data-testid="followers-count">
                {socialStats.followersCount}
              </span>
              <span className="text-muted-foreground">Followers</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
