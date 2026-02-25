'use client';

import { useState, useEffect } from 'react';
import FollowListModal from './FollowListModal';

type TabType = 'followers' | 'following';

interface FollowStatsProps {
  profileAddress: string;
  currentUserAddress?: string;
}

export default function FollowStats({
  profileAddress,
  currentUserAddress,
}: FollowStatsProps) {
  const [stats, setStats] = useState({ followersCount: 0, followingCount: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<TabType>('followers');

  useEffect(() => {
    if (!profileAddress) return;
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/users/${profileAddress}/follow-stats`,
    )
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {});
  }, [profileAddress]);

  const openModal = (tab: TabType) => {
    setDefaultTab(tab);
    setModalOpen(true);
  };

  return (
    <>
      <div className="flex items-center gap-4">
        <button
          onClick={() => openModal('followers')}
          className="text-sm hover:opacity-80 transition-opacity text-left"
        >
          <span className="font-semibold text-white">
            {stats.followersCount}
          </span>{' '}
          <span className="text-gray-400">Followers</span>
        </button>

        <button
          onClick={() => openModal('following')}
          className="text-sm hover:opacity-80 transition-opacity text-left"
        >
          <span className="font-semibold text-white">
            {stats.followingCount}
          </span>{' '}
          <span className="text-gray-400">Following</span>
        </button>
      </div>

      <FollowListModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        profileAddress={profileAddress}
        currentUserAddress={currentUserAddress}
        defaultTab={defaultTab}
        followersCount={stats.followersCount}
        followingCount={stats.followingCount}
      />
    </>
  );
}
