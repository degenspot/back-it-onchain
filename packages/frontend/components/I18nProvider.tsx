"use client";

import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import React, { useState, useEffect } from "react";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import de from "@/messages/de.json";

const messages: Record<string, AbstractIntlMessages> = { en, es, de };

/** Locales this app ships complete translations for (FE-26). */
export const SUPPORTED_LOCALES = ["en", "es", "de"] as const;

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    const saved = localStorage.getItem("app-locale");
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) {
      setLocale(saved);
    }
    const handleLocaleChange = (e: CustomEvent<{ locale: string }>) => {
      setLocale(e.detail.locale);
    };
    window.addEventListener("localeChange" as keyof WindowEventMap, handleLocaleChange as EventListener);
    return () =>
      window.removeEventListener(
        "localeChange" as keyof WindowEventMap,
        handleLocaleChange as EventListener,
      );
  }, []);

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
  const event = new CustomEvent("localeChange", {
    detail: { locale: newLocale },
  });
  window.dispatchEvent(event);
};