'use client';

/**
 * Notification inbox (FE-09).
 *
 * Push over a Socket.io `user:<id>` room, with polling underneath. The two
 * cover different failures: a socket is blocked by some networks and can stop
 * delivering without disconnecting, while polling alone makes a notification
 * feel late. Polling continues while the socket is connected, just slower, so
 * a silently dead socket still self-corrects.
 */

import * as React from 'react';
import { notificationEventAllowed, type NotificationPreferences } from './useNotificationPreferences';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body?: string;
  read: boolean;
  createdAt: string;
  /** Where the bell should navigate on click. */
  href?: string;
}

/** The event name the backend broadcasts on the user room. */
export const NOTIFICATION_EVENT = 'user.notification';

/** Poll interval while the socket is unavailable. */
export const POLL_INTERVAL_MS = 15_000;

/** Slower poll retained while the socket is connected, to catch silent death. */
export const BACKGROUND_POLL_INTERVAL_MS = 90_000;

/** Minimal socket surface this hook needs. */
export interface NotificationSocket {
  on: (event: string, handler: (payload: AppNotification) => void) => void;
  off: (event: string, handler?: (payload: AppNotification) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  disconnect: () => void;
}

export type NotificationSocketFactory = (room: string) => NotificationSocket;

/** The room a user's notifications are broadcast on. */
export function roomForUser(userId: string): string {
  return `user:${userId}`;
}

export interface UseNotificationsOptions {
  socketFactory?: NotificationSocketFactory;
  fetchNotifications?: (userId: string) => Promise<AppNotification[]>;
  markRead?: (userId: string, notificationId: string) => Promise<void>;
  remove?: (userId: string, notificationId: string) => Promise<void>;
  pollIntervalMs?: number;
  backgroundPollIntervalMs?: number;
  enabled?: boolean;
  preferences?: NotificationPreferences;
}

export interface UseNotificationsResult {
  notifications: AppNotification[];
  unreadCount: number;
  connected: boolean;
  isLoading: boolean;
  error: Error | null;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  dismiss: (id: string) => void;
}

export function useNotificationsSocket(
  userId: string | undefined,
  options: UseNotificationsOptions = {},
): UseNotificationsResult {
  const {
    socketFactory,
    fetchNotifications,
    markRead,
    remove,
    pollIntervalMs = POLL_INTERVAL_MS,
    backgroundPollIntervalMs = BACKGROUND_POLL_INTERVAL_MS,
    enabled = true,
    preferences,
  } = options;

  const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
  const [connected, setConnected] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(Boolean(userId && enabled));
  const [error, setError] = React.useState<Error | null>(null);

  const upsert = React.useCallback((incoming: AppNotification) => {
    if (preferences && !notificationEventAllowed(preferences, incoming.type, 'in_app')) return;
    setNotifications((current) => {
      const without = current.filter((entry) => entry.id !== incoming.id);

      return [incoming, ...without];
    });
  }, [preferences]);

  // Socket subscription.
  React.useEffect(() => {
    if (!enabled || !socketFactory || !userId) return;

    const socket = socketFactory(roomForUser(userId));
    const handler = (payload: AppNotification) => upsert(payload);

    socket.on(NOTIFICATION_EVENT, handler);
    socket.emit('join', roomForUser(userId));
    setConnected(true);

    return () => {
      socket.off(NOTIFICATION_EVENT, handler);
      socket.disconnect();
      setConnected(false);
    };
  }, [enabled, socketFactory, upsert, userId]);

  // Polling fallback.
  React.useEffect(() => {
    if (!enabled || !fetchNotifications || !userId) return;

    let cancelled = false;

    const load = async () => {
      try {
        const fetched = await fetchNotifications(userId);

        if (cancelled) return;

        setNotifications((current) => {
          // Merge rather than replace: a notification pushed over the socket
          // moments ago may not be in this poll's response yet, and dropping
          // it would make it flicker out of the list.
          const allowed = preferences
            ? fetched.filter((entry) => notificationEventAllowed(preferences, entry.type, 'in_app'))
            : fetched;
          const byId = new Map(allowed.map((entry) => [entry.id, entry]));

          for (const entry of current) {
            if (!byId.has(entry.id)) byId.set(entry.id, entry);
          }

          return [...byId.values()].sort(
            (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
          );
        });

        setError(null);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught : new Error(String(caught)));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    const interval = setInterval(load, connected ? backgroundPollIntervalMs : pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    backgroundPollIntervalMs,
    connected,
    enabled,
    fetchNotifications,
    pollIntervalMs,
    preferences,
    userId,
  ]);

  const markAsRead = React.useCallback(
    (id: string) => {
      // Optimistic: the badge should clear the moment it is opened.
      setNotifications((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, read: true } : entry)),
      );

      if (userId && markRead) {
        void markRead(userId, id).catch((caught: unknown) => {
          setNotifications((current) =>
            current.map((entry) => (entry.id === id ? { ...entry, read: false } : entry)),
          );
          setError(caught instanceof Error ? caught : new Error(String(caught)));
        });
      }
    },
    [markRead, userId],
  );

  const markAllAsRead = React.useCallback(() => {
    const unread = notifications.filter((entry) => !entry.read);

    for (const entry of unread) markAsRead(entry.id);
  }, [markAsRead, notifications]);

  const dismiss = React.useCallback(
    (id: string) => {
      const removed = notifications.find((entry) => entry.id === id);

      setNotifications((current) => current.filter((entry) => entry.id !== id));

      if (userId && remove) {
        void remove(userId, id).catch((caught: unknown) => {
          // Put it back — a delete that failed has not happened, and silently
          // dropping it would lose a notification the user never dismissed.
          if (removed) upsert(removed);

          setError(caught instanceof Error ? caught : new Error(String(caught)));
        });
      }
    },
    [notifications, remove, upsert, userId],
  );

  return {
    notifications,
    unreadCount: notifications.filter((entry) => !entry.read).length,
    connected,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    dismiss,
  };
}
