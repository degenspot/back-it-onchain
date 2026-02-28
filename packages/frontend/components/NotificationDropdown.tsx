"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import { NotificationData, NotificationItem } from './NotificationItem';

interface NotificationDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationData[];
  unreadCount: number;
  isLoading: boolean;
  onMarkAsRead: (id: string) => void;
  onMarkAllRead: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isWalletConnected?: boolean;
}

export function NotificationDropdown({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  isLoading,
  onMarkAsRead,
  onMarkAllRead,
  onLoadMore,
  hasMore,
  isWalletConnected = true,
}: NotificationDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 mt-2 w-96 bg-background rounded-2xl shadow-2xl border border-border z-100 max-h-[500px] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-border bg-secondary/30 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-foreground">Notifications</h3>
          {unreadCount > 0 && (
            <span className="bg-primary/10 text-primary text-[10px] px-2 py-0.5 rounded-full font-bold">
              {unreadCount} NEW
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllRead}
            className="text-xs text-primary hover:text-primary/80 font-bold transition-colors uppercase tracking-wider"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Notifications List */}
      <div className="overflow-y-auto flex-1 custom-scrollbar">
        {isLoading && notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
            <p className="text-xs text-muted-foreground animate-pulse">Loading updates...</p>
          </div>
        ) : !isWalletConnected ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
               <Bell className="w-6 h-6" />
            </div>
            <p className="text-foreground font-bold text-sm">Wallet Not Connected</p>
            <p className="text-muted-foreground text-xs mt-1 leading-relaxed">
              Please connect your wallet to receive and view notifications.
            </p>
          </div>
        ) : notifications.length > 0 ? (
          <div className="divide-y divide-border/50">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={onMarkAsRead}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-4 text-muted-foreground">
               <Bell className="w-6 h-6 opacity-20" />
            </div>
            <p className="text-foreground font-bold text-sm">All caught up!</p>
            <p className="text-muted-foreground text-xs mt-1">No new notifications at the moment.</p>
          </div>
        )}
      </div>

      {/* Load More Button */}
      {hasMore && (
        <div className="border-t border-border p-3 text-center bg-secondary/10">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="w-full py-2 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all disabled:opacity-50"
          >
            {isLoading ? 'Loading more...' : 'View older notifications'}
          </button>
        </div>
      )}
    </div>
  );
}
