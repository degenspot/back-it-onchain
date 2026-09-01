'use client';

import { useLocale, useMessages } from 'next-intl';
import * as React from 'react';
import en from '@/messages/en.json';

type Json = Record<string, unknown>;

function flattenKeys(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object'
      ? flattenKeys(value as Json, path)
      : [path];
  });
}

/**
 * Dev-only missing-key audit surface (FE-26).
 *
 * When a locale's message file is missing keys that exist in `en`, this panel
 * lists them so translators can fill the gaps. In production it renders nothing.
 */
export function MissingKeyNotice() {
  const locale = useLocale();
  const messages = useMessages() as Json;

  const enKeys = React.useMemo(() => new Set(flattenKeys(en as Json)), []);
  const missing = React.useMemo(
    () => [...enKeys].filter((key) => path(messages, key) === undefined),
    [enKeys, messages],
  );

  if (process.env.NODE_ENV === 'production' || missing.length === 0) return null;

  return (
    <div
      data-testid="missing-key-notice"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700"
    >
      <strong>{locale}</strong> is missing {missing.length} translation key
      {missing.length === 1 ? '' : 's'}: {missing.slice(0, 6).join(', ')}
      {missing.length > 6 ? ', …' : ''}
    </div>
  );
}

function path(obj: Json, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Json)[part];
    return undefined;
  }, obj);
}
