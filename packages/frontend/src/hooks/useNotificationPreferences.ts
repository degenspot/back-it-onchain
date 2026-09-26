'use client';

import * as React from 'react';
import { z } from 'zod';

export const notificationEventSchema = z.enum(['followed_call', 'counter_stake', 'expiry_1h', 'payout_ready']);
export const notificationChannelSchema = z.enum(['in_app', 'push', 'webhook']);
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationPreferencesSchema = z.object({
  events: z.record(notificationEventSchema, z.boolean()),
  channels: z.record(notificationChannelSchema, z.boolean()),
  matrix: z.record(notificationEventSchema, z.record(notificationChannelSchema, z.boolean())),
});

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  events: {
    followed_call: true,
    counter_stake: true,
    expiry_1h: true,
    payout_ready: true,
  },
  channels: {
    in_app: true,
    push: false,
    webhook: false,
  },
  matrix: {
    followed_call: { in_app: true, push: false, webhook: false },
    counter_stake: { in_app: true, push: false, webhook: false },
    expiry_1h: { in_app: true, push: false, webhook: false },
    payout_ready: { in_app: true, push: false, webhook: false },
  },
};

const STORAGE_KEY = 'backit-notification-preferences-v1';

function readPreferences(): NotificationPreferences {
  if (typeof window === 'undefined') return DEFAULT_NOTIFICATION_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? notificationPreferencesSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? parsed.data : DEFAULT_NOTIFICATION_PREFERENCES;
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export function notificationEventAllowed(preferences: NotificationPreferences, event: string, channel: NotificationChannel = 'in_app'): boolean {
  const eventKey = event as NotificationEvent;
  return preferences.matrix[eventKey]?.[channel] ?? (preferences.events[eventKey] !== false && preferences.channels[channel] !== false);
}

export function useNotificationPreferences(options: { wallet?: string; save?: (preferences: NotificationPreferences) => Promise<void> } = {}) {
  const [preferences, setPreferences] = React.useState<NotificationPreferences>(readPreferences);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const setEvent = React.useCallback((event: NotificationEvent, enabled: boolean) => {
    setPreferences((current) => ({ ...current, events: { ...current.events, [event]: enabled } }));
  }, []);

  const setChannel = React.useCallback((channel: NotificationChannel, enabled: boolean) => {
    setPreferences((current) => ({ ...current, channels: { ...current.channels, [channel]: enabled } }));
  }, []);

  const setMatrix = React.useCallback((event: NotificationEvent, channel: NotificationChannel, enabled: boolean) => {
    setPreferences((current) => ({
      ...current,
      matrix: { ...current.matrix, [event]: { ...current.matrix[event], [channel]: enabled } },
    }));
  }, []);

  const save = React.useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (options.save) {
        await options.save(preferences);
      } else if (options.wallet) {
        const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
        const response = await fetch(`${base}/users/me/settings?wallet=${encodeURIComponent(options.wallet)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(preferences),
        });
        if (!response.ok) throw new Error(`Could not save preferences (${response.status})`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
      throw caught;
    } finally {
      setIsSaving(false);
    }
  }, [options, preferences]);

  return { preferences, setEvent, setChannel, setMatrix, save, isSaving, error };
}
