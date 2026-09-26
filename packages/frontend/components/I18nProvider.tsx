"use client";

import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import React, { useState, useEffect } from "react";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import de from "@/messages/de.json";
import ja from "@/messages/ja.json";
import zh from "@/messages/zh.json";
import ar from "@/messages/ar.json";
import {
  LOCALES,
  DEFAULT_LOCALE,
  directionFor,
  isLocale,
  type Locale,
} from "@/src/i18n/locales";

const messages: Record<Locale, AbstractIntlMessages> = { en, es, de, ja, zh, ar };

/**
 * Locales this app ships complete translations for.
 *
 * Re-exported from the shared registry so existing importers keep working.
 */
export const SUPPORTED_LOCALES = LOCALES;

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const saved = localStorage.getItem("app-locale");
    if (isLocale(saved)) {
      setLocale(saved);
    }
    const handleLocaleChange = (e: CustomEvent<{ locale: string }>) => {
      if (isLocale(e.detail?.locale)) {
        setLocale(e.detail.locale);
      }
    };
    window.addEventListener("localeChange" as keyof WindowEventMap, handleLocaleChange as EventListener);
    return () =>
      window.removeEventListener(
        "localeChange" as keyof WindowEventMap,
        handleLocaleChange as EventListener,
      );
  }, []);

  /*
   * Mirror the active locale onto <html>. `dir` is what flips the layout for
   * Arabic — Tailwind's logical properties (ms-/me-/ps-/pe-, text-start/end)
   * key off it, so the whole tree mirrors without a second stylesheet. It has
   * to live on the document element rather than a wrapper, since `dir` is
   * inherited and scrollbar/caret placement follow the root.
   */
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionFor(locale);
  }, [locale]);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      timeZone="UTC"
    >
      {children}
    </NextIntlClientProvider>
  );
}

export const switchLocale = (newLocale: string) => {
  localStorage.setItem("app-locale", newLocale);
  // Keep the server's cookie-based resolution in step with the client choice.
  document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; samesite=lax`;
  const event = new CustomEvent("localeChange", {
    detail: { locale: newLocale },
  });
  window.dispatchEvent(event);
};
