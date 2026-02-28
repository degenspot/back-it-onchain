'use client';

import { useState, useEffect, useCallback } from 'react';
import FollowUserCard from './FollowUserCard';

type TabType = 'followers' | 'following';

interface FollowUser {
  id: string;
  address: string;
  username?: string;
  avatar?: string;
  trustScore?: number;
  followedAt: string;
}

interface FollowListModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileAddress: string;
  currentUserAddress?: string;
  defaultTab?: TabType;
  followersCount?: number;
  followingCount?: number;
}

export default function FollowListModal({
  isOpen,
  onClose,
  profileAddress,
  currentUserAddress,
  defaultTab = 'followers',
  followersCount = 0,
  followingCount = 0,
}: FollowListModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;

  const fetchList = useCallback(
    async (tab: TabType, pageNum: number, reset = false) => {
      setLoading(true);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/users/${profileAddress}/${tab}?page=${pageNum}&limit=${LIMIT}`,
        );
        if (!res.ok) return;
        const json = await res.json();
        setTotal(json.total);
        setUsers((prev) =>
          reset ? json.data : [...prev, ...json.data],
        );
      } finally {
        setLoading(false);
      }
    },
    [profileAddress],
  );

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(defaultTab);
    setPage(1);
    setUsers([]);
    fetchList(defaultTab, 1, true);
  }, [isOpen, defaultTab, fetchList]);

  const handleTabChange = (tab: TabType) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setPage(1);
    setUsers([]);
    fetchList(tab, 1, true);
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchList(activeTab, nextPage);
  };

  const hasMore = users.length < total;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
          <h2 className="text-base font-semibold text-white">
            {profileAddress.slice(0, 6)}...{profileAddress.slice(-4)}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 shrink-0 mx-4">
          <button
            onClick={() => handleTabChange('followers')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'followers'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Followers
            <span className="ml-1.5 text-xs text-gray-400">
              {followersCount}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('following')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'following'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Following
            <span className="ml-1.5 text-xs text-gray-400">
              {followingCount}
            </span>
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 py-2">
          {loading && users.length === 0 ? (
            <div className="flex flex-col gap-2 px-4 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3 px-0 animate-pulse">
                  <div className="h-10 w-10 rounded-full bg-white/10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-28 bg-white/10 rounded" />
                    <div className="h-2.5 w-20 bg-white/5 rounded" />
                  </div>
                  <div className="h-7 w-16 bg-white/10 rounded-lg" />
                </div>
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-sm">
              <svg className="w-10 h-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              No {activeTab} yet
            </div>
          ) : (
            <div className="px-2">
              {users.map((user) => (
                <FollowUserCard
                  key={user.id}
                  user={user}
                  currentUserAddress={currentUserAddress}
                />
              ))}

              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="w-full py-3 text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
