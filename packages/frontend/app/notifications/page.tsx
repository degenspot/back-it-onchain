'use client';

/**
 * Full notification inbox (FE-09).
 *
 * The dropdown is for glancing; this page is for working through a backlog,
 * so it renders the same data unbounded rather than in a scrollable panel.
 */

import * as React from 'react';
import { AppLayout } from '@/components/AppLayout';
import { NotificationBell } from '@/src/components/NotificationBell';
import { NotificationPreferences } from '@/src/components/NotificationPreferences';

export default function NotificationsPage() {
  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Notifications</h1>
          <NotificationBell />
        </div>

        <p className="text-sm text-gray-600">
          Real-time updates arrive over your notification channel; the list refreshes on a
          fallback poll if that channel is unavailable.
        </p>

        <NotificationPreferences />
      </div>
    </AppLayout>
  );
}
