'use client';

import * as React from 'react';
import { BellRing, Check, Loader, Send, X } from 'lucide-react';
import {
  notificationChannelSchema,
  notificationEventSchema,
  useNotificationPreferences,
  type NotificationChannel,
  type NotificationEvent,
} from '@/src/hooks/useNotificationPreferences';
import { cn } from '@/lib/utils';

export interface NotificationPreferencesProps {
  wallet?: string;
  socket?: { emit: (event: string, ...args: unknown[]) => void };
  onTestNotification?: (event: NotificationEvent) => Promise<void> | void;
  save?: (preferences: ReturnType<typeof useNotificationPreferences>['preferences']) => Promise<void>;
}

const eventLabels: Record<NotificationEvent, string> = {
  followed_call: 'New call from followed user',
  counter_stake: 'Counter-stake against my position',
  expiry_1h: 'Call expires in 1 hour',
  payout_ready: 'Payout is ready',
};

const channelLabels: Record<NotificationChannel, string> = {
  in_app: 'In-app',
  push: 'Push',
  webhook: 'Webhook',
};

export function NotificationPreferences({ wallet, socket, onTestNotification, save }: NotificationPreferencesProps) {
  const { preferences, setMatrix, save: savePreferences, isSaving, error } = useNotificationPreferences({ wallet, save });
  const [testEvent, setTestEvent] = React.useState<NotificationEvent>('followed_call');

  React.useEffect(() => {
    socket?.emit('notificationPreferencesUpdated', preferences);
  }, [preferences, socket]);

  const runTest = async () => {
    await onTestNotification?.(testEvent);
  };

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-4" data-testid="notification-preferences">
      <div className="flex items-center gap-2">
        <BellRing className="h-5 w-5 text-primary" />
        <div><h2 className="font-semibold">Notification preferences</h2><p className="text-xs text-muted-foreground">Choose which events reach each channel.</p></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-md text-sm">
          <thead><tr><th className="p-2 text-left font-medium">Event</th>{notificationChannelSchema.options.map((channel) => <th key={channel} className="p-2 text-center font-medium">{channelLabels[channel]}</th>)}</tr></thead>
          <tbody>
            {notificationEventSchema.options.map((event) => (
              <tr key={event} className="border-t border-border">
                <th scope="row" className="p-2 text-left font-normal">{eventLabels[event]}</th>
                {notificationChannelSchema.options.map((channel) => {
                  const enabled = preferences.matrix[event]?.[channel] ?? false;
                  return <td key={channel} className="p-2 text-center"><button type="button" aria-label={`${eventLabels[event]} ${channelLabels[channel]}`} aria-pressed={enabled} onClick={() => setMatrix(event, channel, !enabled)} className={cn('rounded-full p-1.5', enabled ? 'bg-green-500/15 text-green-500' : 'bg-secondary text-muted-foreground')}><Check className={cn('h-4 w-4', !enabled && 'opacity-0')} /></button></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        <label className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">Test event<select value={testEvent} onChange={(event) => setTestEvent(event.target.value as NotificationEvent)} className="rounded border border-border bg-background px-2 py-1.5 text-foreground">{notificationEventSchema.options.map((event) => <option key={event} value={event}>{eventLabels[event]}</option>)}</select></label>
        <button type="button" onClick={() => void runTest()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary"><Send className="h-3.5 w-3.5" /> Send test</button>
        <button type="button" onClick={() => void savePreferences()} disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save</button>
      </div>
      {error ? <p className="flex items-center gap-1 text-xs text-red-500" role="alert"><X className="h-3.5 w-3.5" />{error.message}</p> : null}
    </section>
  );
}

export default NotificationPreferences;
