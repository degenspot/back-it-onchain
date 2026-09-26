'use client';

import { useLocale, useTranslations } from 'next-intl';
import React from 'react';
import { Languages } from 'lucide-react';
import { switchLocale } from './I18nProvider';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/src/i18n/locales';

/**
 * Language selector (FE-040).
 *
 * This was a cycle button, which was workable at three locales and isn't at
 * six — you could not reach Arabic without pressing through four others, and
 * nothing told you what the options were. A native select is directly
 * addressable, keyboard operable for free, and gets the platform's own
 * picker on mobile.
 */
export default function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations('Common');

  return (
    <div className="relative flex items-center">
      <Languages className="pointer-events-none absolute start-3 h-4 w-4" aria-hidden="true" />
      <select
        value={locale}
        onChange={(e) => switchLocale(e.target.value)}
        aria-label={t('language_selector')}
        className="h-10 appearance-none rounded-lg border border-border bg-background ps-9 pe-3 text-sm font-medium transition-colors hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {LOCALES.map((code: Locale) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
