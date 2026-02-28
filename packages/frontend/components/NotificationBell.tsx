"use client";

import React, { useState, useEffect } from 'react';
import { NotificationDropdown } from './NotificationDropdown';
import { NotificationData, NotificationItem } from './NotificationItem';
import { Bell } from 'lucide-react';
import { useGlobalState } from './GlobalState';
import { cn } from '@/lib/utils';

interface NotificationBellProps {
  userWallet?: string;
  pollingInterval?: number; // in milliseconds, default 30000 (30 seconds)
}

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

export function NotificationBell({
  userWallet: propWallet,
  pollingInterval = 30000,
}: NotificationBellProps) {
  const { currentUser } = useGlobalState();
  const userWallet = propWallet || currentUser?.wallet;
  
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalPages, setTotalPages] = useState(1);

  // Fetch unread count
  const fetchUnreadCount = async () => {
    if (!userWallet) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/notifications/unread-count`,
        {
          headers: {
            'x-user-wallet': userWallet,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.unreadCount);
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  };

  // Fetch notifications
  const fetchNotifications = async (page: number = 1) => {
    if (!userWallet) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/notifications?page=${page}&limit=10`,
        {
          headers: {
            'x-user-wallet': userWallet,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const fetchedNotifications = data.notifications || [];
        
        if (page === 1) {
          setNotifications(fetchedNotifications);
        } else {
          setNotifications((prev) => [...prev, ...fetchedNotifications]);
        }
        setCurrentPage(page);
        setTotalPages(data.totalPages || 1);
        setHasMore(page < (data.totalPages || 1));
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Mark notification as read
  const handleMarkAsRead = async (notificationId: string) => {
    if (!userWallet) return;
    try {
      await fetch(`${API_BASE_URL}/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: {
          'x-user-wallet': userWallet,
        },
      });

      setNotifications((prev) =>
        prev.map((notif) =>
          notif.id === notificationId ? { ...notif, isRead: true } : notif
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  // Mark all as read
  const handleMarkAllRead = async () => {
    if (!userWallet) return;
    try {
      await fetch(`${API_BASE_URL}/notifications/mark-all-read`, {
        method: 'PATCH',
        headers: {
          'x-user-wallet': userWallet,
        },
      });

      setNotifications((prev) =>
        prev.map((notif) => ({ ...notif, isRead: true }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  };

  // Handle load more
  const handleLoadMore = () => {
    fetchNotifications(currentPage + 1);
  };

  // Set up polling and initial fetch when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  // Set up polling for unread count
  useEffect(() => {
    if (!userWallet) return;

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, pollingInterval);

    return () => clearInterval(interval);
  }, [userWallet, pollingInterval]);


  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-xl transition-all"
        aria-label="Notifications"
      >
        <Bell className={cn("h-6 w-6", unreadCount > 0 && "text-primary")} />

        {/* Unread indicator badge */}
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <NotificationDropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        isLoading={isLoading}
        onMarkAsRead={handleMarkAsRead}
        onMarkAllRead={handleMarkAllRead}
        onLoadMore={handleLoadMore}
        hasMore={hasMore}
        isWalletConnected={!!userWallet}
      />
    </div>
  );
}
