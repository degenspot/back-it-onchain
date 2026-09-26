/**
 * Single source of truth for shipped locales and their writing direction
 * (FE-040).
 *
 * `src/i18n/request.ts` (server) and `components/I18nProvider.tsx` (client)
 * both read from here so the two can't drift — previously each kept its own
 * hardcoded list.
 */

export const LOCALES = ["en", "es", "de", "ja", "zh", "ar"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Locales written right-to-left. */
const RTL_LOCALES = new Set<Locale>(["ar"]);

/** Endonyms — a language menu should name each language in its own script. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  ja: "日本語",
  zh: "中文",
  ar: "العربية",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/** Writing direction for a locale, for the `dir` attribute. */
export function directionFor(locale: string): "ltr" | "rtl" {
  return isLocale(locale) && RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}
