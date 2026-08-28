'use client';

import { useLocale } from 'next-intl';
import React from 'react';
import { Languages } from 'lucide-react';
import { switchLocale, SUPPORTED_LOCALES } from './I18nProvider';

export default function LanguageSwitcher() {
  const locale = useLocale();

  const handleToggle = () => {
    const locales: readonly string[] = [...SUPPORTED_LOCALES];
    const index = locales.indexOf(locale);
    const nextLocale = locales[(index + 1) % locales.length];
    switchLocale(nextLocale);
  };

  return (
    <button
      onClick={handleToggle}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-secondary/50 transition-colors h-10 text-sm font-medium"
      title="Switch Language"
    >
      <Languages className="h-4 w-4" />
      <span>{locale.toUpperCase()}</span>
    </button>
  );
}
