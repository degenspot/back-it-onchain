'use client';

import { useState } from 'react';
import Image from 'next/image';

interface FollowUser {
  id: string;
  address: string;
  username?: string;
  avatar?: string;
  trustScore?: number;
  followedAt: string;
}

interface FollowUserCardProps {
  user: FollowUser;
  currentUserAddress?: string;
  onFollowToggle?: (address: string, isFollowing: boolean) => void;
}

export default function FollowUserCard({
  user,
  currentUserAddress,
  onFollowToggle,
}: FollowUserCardProps) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  const isSelf =
    currentUserAddress?.toLowerCase() === user.address.toLowerCase();

  const displayName =
    user.username ||
    `${user.address.slice(0, 6)}...${user.address.slice(-4)}`;

  const handleToggle = async () => {
    if (!currentUserAddress || isSelf) return;
    setLoading(true);
    try {
      const endpoint = isFollowing
        ? `/users/${user.address}/unfollow`
        : `/users/${user.address}/follow`;

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}${endpoint}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        },
      );

      if (res.ok) {
        setIsFollowing((prev) => !prev);
        onFollowToggle?.(user.address, !isFollowing);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 py-3 px-4 hover:bg-white/5 rounded-xl transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative h-10 w-10 shrink-0 rounded-full overflow-hidden bg-gray-700">
          {user.avatar ? (
            <Image
              src={user.avatar}
              alt={displayName}
              fill
              className="object-cover"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-sm font-semibold text-white uppercase">
              {displayName[0]}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {displayName}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {user.address.slice(0, 6)}...{user.address.slice(-4)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {user.trustScore !== undefined && (
          <span className="hidden sm:inline-flex items-center gap-1 text-xs text-yellow-400 font-medium">
            <svg
              className="w-3 h-3"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {user.trustScore}
          </span>
        )}

        {currentUserAddress && !isSelf && (
          <button
            onClick={handleToggle}
            disabled={loading}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
              isFollowing
                ? 'border-gray-600 text-gray-300 hover:border-red-500 hover:text-red-400'
                : 'border-blue-500 text-blue-400 hover:bg-blue-500 hover:text-white'
            }`}
          >
            {loading ? '...' : isFollowing ? 'Unfollow' : 'Follow'}
          </button>
        )}
      </div>
    </div>
  );
}
