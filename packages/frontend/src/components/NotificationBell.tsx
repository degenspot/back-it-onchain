'use client';

import * as React from 'react';
import {
  useNotificationsSocket,
  type AppNotification,
  type UseNotificationsOptions,
} from '../hooks/useNotificationsSocket';
import { useNotificationPreferences } from '../hooks/useNotificationPreferences';

export interface NotificationBellProps extends UseNotificationsOptions {
  userId?: string;
  /** Cap shown on the badge before it becomes "N+". */
  maxBadgeCount?: number;
}

function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));

  if (seconds < 60) return 'just now';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;

  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function NotificationRow({
  notification,
  onRead,
  onDismiss,
  now,
}: {
  notification: AppNotification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  now: number;
}) {
  return (
    <li
      data-testid={`notification-${notification.id}`}
      data-read={notification.read}
      className={notification.read ? 'flex gap-2 p-2' : 'flex gap-2 bg-blue-50 p-2'}
    >
      <button
        type="button"
        data-testid={`notification-open-${notification.id}`}
        onClick={() => onRead(notification.id)}
        className="flex-1 text-left"
      >
        <span className="block text-sm font-medium">{notification.title}</span>
        {notification.body ? (
          <span className="block text-xs text-gray-600">{notification.body}</span>
        ) : null}
        <span className="block text-xs text-gray-400">{timeAgo(notification.createdAt, now)}</span>
      </button>

      <button
        type="button"
        aria-label={`Dismiss ${notification.title}`}
        data-testid={`notification-dismiss-${notification.id}`}
        onClick={() => onDismiss(notification.id)}
        className="text-xs text-gray-500"
      >
        ✕
      </button>
    </li>
  );
}

/**
 * Inbox bell with an unread badge and a dropdown (FE-09).
 *
 * The badge caps rather than growing without bound — the difference between
 * 99 and 4,312 unread is not information anyone acts on, and a four-digit
 * badge breaks the layout.
 */
export function NotificationBell({ userId, maxBadgeCount = 99, ...options }: NotificationBellProps) {
  const [open, setOpen] = React.useState(false);
  const { preferences } = useNotificationPreferences();
  const { notifications, unreadCount, connected, isLoading, error, markAsRead, markAllAsRead, dismiss } =
    useNotificationsSocket(userId, { ...options, preferences });

  const now = Date.now();

  return (
    <div className="relative" data-testid="notification-bell">
      <button
        type="button"
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
        }
        aria-expanded={open}
        data-testid="notification-bell-button"
        onClick={() => setOpen((current) => !current)}
        className="relative rounded-full p-2"
      >
        <span aria-hidden="true">🔔</span>

        {unreadCount > 0 ? (
          <span
            data-testid="notification-badge"
            className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs text-white"
          >
            {unreadCount > maxBadgeCount ? `${maxBadgeCount}+` : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          data-testid="notification-dropdown"
          className="absolute right-0 z-10 mt-2 w-80 rounded border bg-white shadow"
        >
          <div className="flex items-center justify-between border-b p-2">
            <span className="text-sm font-semibold">Notifications</span>
            <span className="flex items-center gap-2">
              {connected ? (
                <span data-testid="notification-live" className="text-xs text-green-600">
                  Live
                </span>
              ) : null}
              {unreadCount > 0 ? (
                <button
                  type="button"
                  data-testid="notification-mark-all"
                  onClick={markAllAsRead}
                  className="text-xs underline"
                >
                  Mark all read
                </button>
              ) : null}
            </span>
          </div>

          {error ? (
            <p role="alert" data-testid="notification-error" className="p-2 text-xs text-red-600">
              {error.message}
            </p>
          ) : null}

          {isLoading ? (
            <p data-testid="notification-loading" className="p-2 text-sm text-gray-500">
              Loading…
            </p>
          ) : null}

          {!isLoading && notifications.length === 0 ? (
            <p data-testid="notification-empty" className="p-4 text-sm text-gray-500">
              You’re all caught up.
            </p>
          ) : null}

          {notifications.length > 0 ? (
            <ul data-testid="notification-list" className="max-h-80 divide-y overflow-y-auto">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onRead={markAsRead}
                  onDismiss={dismiss}
                  now={now}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default NotificationBell;
