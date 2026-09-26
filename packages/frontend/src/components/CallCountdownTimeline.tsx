'use client';

import * as React from 'react';
import { Check, Circle, Clock, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CallLifecycle = 'ACTIVE' | 'PENDING_RESOLUTION' | 'ORACLE_VERIFICATION' | 'DISPUTE_WINDOW' | 'SETTLED';

export interface CallCountdownTimelineProps {
  status?: string | number;
  deadline?: string | number | Date;
  startedAt?: string | number | Date;
  oracleVerifiedAt?: string | number | Date;
  disputeEndsAt?: string | number | Date;
  onExpired?: () => void;
  className?: string;
}

const lifecycleOrder: CallLifecycle[] = [
  'ACTIVE',
  'PENDING_RESOLUTION',
  'ORACLE_VERIFICATION',
  'DISPUTE_WINDOW',
  'SETTLED',
];

function toTimestamp(value: string | number | Date | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const timestamp = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeCallLifecycle(status?: string | number): CallLifecycle {
  const normalized = String(status ?? 'ACTIVE').toUpperCase().replaceAll('-', '_');
  if (normalized === 'OPEN' || normalized === 'ACTIVE') return 'ACTIVE';
  if (normalized === 'SETTLING' || normalized === 'PENDING_RESOLUTION' || normalized === 'PENDING') return 'PENDING_RESOLUTION';
  if (normalized === 'ORACLE_VERIFICATION' || normalized === 'VERIFYING') return 'ORACLE_VERIFICATION';
  if (normalized === 'DISPUTE' || normalized === 'DISPUTE_WINDOW') return 'DISPUTE_WINDOW';
  return 'SETTLED';
}

export function formatRemaining(milliseconds: number): string {
  if (milliseconds <= 0) return '00:00:00.000';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(milliseconds % 1000);
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${clock}.${String(millis).padStart(3, '0')}` : `${clock}.${String(millis).padStart(3, '0')}`;
}

export function lifecycleStage(status?: string | number): number {
  return lifecycleOrder.indexOf(normalizeCallLifecycle(status));
}

export function CallCountdownTimeline({
  status,
  deadline,
  startedAt,
  oracleVerifiedAt,
  disputeEndsAt,
  onExpired,
  className,
}: CallCountdownTimelineProps) {
  const [now, setNow] = React.useState(() => Date.now());
  const [hasExpired, setHasExpired] = React.useState(false);
  const end = toTimestamp(deadline);
  const currentStage = lifecycleStage(status);
  const target = end ?? toTimestamp(disputeEndsAt) ?? now;

  React.useEffect(() => {
    if (end === null || end <= Date.now()) return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [end]);

  React.useEffect(() => {
    if (end === null || end > now || hasExpired) return;
    setHasExpired(true);
    onExpired?.();
  }, [end, hasExpired, now, onExpired]);

  const remaining = Math.max(0, target - now);
  const started = toTimestamp(startedAt) ?? now;
  const progress = end === null ? 0 : Math.min(100, Math.max(0, ((now - started) / Math.max(1, end - started)) * 100));
  const oracleTime = toTimestamp(oracleVerifiedAt);
  const disputeTime = toTimestamp(disputeEndsAt);
  const stageLabel = lifecycleOrder[Math.max(0, currentStage)];

  return (
    <section className={cn('rounded-xl border border-border bg-card p-4', className)} aria-label="Call lifecycle">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Call timeline</p>
          <p className="mt-1 font-semibold">{stageLabel.replaceAll('_', ' ')}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Time remaining</p>
          <p className="font-mono text-sm tabular-nums" data-testid="call-countdown">{formatRemaining(remaining)}</p>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>
      <ol className="mt-4 grid grid-cols-5 gap-1 text-[10px] text-muted-foreground">
        {lifecycleOrder.map((stage, index) => {
          const complete = index < currentStage || stage === 'SETTLED';
          const active = index === currentStage && stage !== 'SETTLED';
          return (
            <li key={stage} className={cn('flex flex-col items-center gap-1 text-center', (complete || active) && 'text-foreground')}>
              {complete ? <Check className="h-3.5 w-3.5 text-green-500" /> : active ? <Loader className="h-3.5 w-3.5 animate-spin text-primary" /> : <Circle className="h-3.5 w-3.5" />}
              <span>{stage.replaceAll('_', ' ')}</span>
            </li>
          );
        })}
      </ol>
      {oracleTime || disputeTime ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {oracleTime ? <span>Oracle verified {new Date(oracleTime).toLocaleString()}</span> : null}
          {disputeTime ? <span>Dispute window closes {new Date(disputeTime).toLocaleString()}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
