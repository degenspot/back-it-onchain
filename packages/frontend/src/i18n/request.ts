import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

/** Locales with shipped translation files (FE-26). */
export const LOCALES = ["en", "es", "de"] as const;
export const DEFAULT_LOCALE = "en";

/**
 * Resolve the active locale for server-rendered components.
 *
 * Priority: the `NEXT_LOCALE` cookie set by middleware (mirroring the client
 * `app-locale` choice), falling back to the browser `Accept-Language` header,
 * then the default (`en`).
 */
function resolveLocale(cookie: string | undefined, acceptLanguage: string | undefined): string {
  if (cookie && (LOCALES as readonly string[]).includes(cookie)) {
    return cookie;
  }

  if (acceptLanguage) {
    const primary = acceptLanguage.split(",")[0]?.trim().split("-")[0]?.toLowerCase();
    if (primary && (LOCALES as readonly string[]).includes(primary)) {
      return primary;
    }
  }

  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const acceptLanguage = headerStore.get("accept-language") ?? undefined;

  const locale = resolveLocale(cookieLocale, acceptLanguage);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "UTC",
  };
});
