"use client";

import React from 'react';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NotificationData {
  id: string;
  type: 'market_resolved' | 'stake_received' | 'new_follower';
  payload: Record<string, any>;
  isRead: boolean;
  createdAt: string;
  resourceId?: string;
  resourceType?: string;
}




interface NotificationItemProps {
  notification: NotificationData;
  onMarkAsRead?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function NotificationItem({
  notification,
  onMarkAsRead,
  onDelete,
}: NotificationItemProps) {
  const handleClick = (e: React.MouseEvent) => {
    if (!notification.isRead && onMarkAsRead) {
      onMarkAsRead(notification.id);
    }
  };

  const getResourceLink = (): string => {
    if (notification.resourceType === 'call' && notification.resourceId) {
      return `/calls/${notification.resourceId}`;
    } else if (notification.resourceType === 'user' && notification.resourceId) {
      return `/profile/${notification.resourceId}`;
    }
    return '#';
  };

  const renderContent = () => {
    switch (notification.type) {
      case 'market_resolved': {
        const { callTitle, outcome, userWon } = notification.payload;
        return (
          <div className="space-y-1">
            <p className="text-[13px] font-bold text-foreground leading-tight">
              Market Resolved: {callTitle}
            </p>
            <p className="text-xs text-muted-foreground leading-normal">
              Outcome: <span className="font-bold text-foreground">{outcome.toUpperCase()}</span>
              {userWon !== undefined && (
                <>
                  {' '}• You{' '}
                  <span className={userWon ? 'text-green-500 font-bold' : 'text-red-500 font-bold'}>
                    {userWon ? 'WON' : 'LOST'}
                  </span>
                </>
              )}
            </p>
          </div>
        );
      }
      case 'stake_received': {
        const { callTitle, staker, amount, choice } = notification.payload;
        return (
          <div className="space-y-1">
            <p className="text-[13px] font-bold text-foreground leading-tight">New Stake on {callTitle}</p>
            <p className="text-xs text-muted-foreground leading-normal">
              <span className="font-bold text-foreground">{staker.slice(0, 6)}...</span> staked{' '}
              <span className="font-bold text-foreground">{amount}</span> on {choice.toUpperCase()}
            </p>
          </div>
        );
      }
      case 'new_follower': {
        const { followerHandle, follower } = notification.payload;
        return (
          <div className="space-y-1">
            <p className="text-[13px] font-bold text-foreground leading-tight">New Follower</p>
            <p className="text-xs text-muted-foreground leading-normal">
              <span className="font-medium text-foreground">{followerHandle || follower.slice(0, 6) + '...'}</span> started
              following you
            </p>
          </div>
        );
      }
      default:
        return null;
    }
  };

  const link = getResourceLink();

  return (
    <Link href={link} className="block w-full">
      <div
        onClick={handleClick}
        className={cn(
          "px-5 py-4 cursor-pointer transition-all hover:bg-secondary/50 flex items-start gap-4",
          !notification.isRead ? 'bg-primary/5' : ''
        )}
      >
        <div className="flex-1 min-w-0">
          {renderContent()}
          <p className="text-[10px] text-muted-foreground/60 mt-1.5 flex items-center gap-1.5 font-medium">
            <Clock className="w-3 h-3" />
            {new Date(notification.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        {!notification.isRead && (
          <div className="w-2.5 h-2.5 bg-primary rounded-full mt-1.5 shrink-0 shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
        )}
      </div>
    </Link>
  );
}
