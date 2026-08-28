import { NextRequest, NextResponse } from "next/server";

const LOCALES = ["en", "es", "de"];
const DEFAULT_LOCALE = "en";

/**
 * Locale detection middleware (FE-26).
 *
 * Picks a locale from the `NEXT_LOCALE` cookie first, then the browser
 * `Accept-Language` header, and pins it so server-rendered `next-intl`
 * components and the client provider agree.
 */
export function middleware(request: NextRequest) {
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  if (cookieLocale && LOCALES.includes(cookieLocale)) {
    return NextResponse.next();
  }

  const acceptLanguage = request.headers.get("accept-language") ?? "";
  const primary = acceptLanguage.split(",")[0]?.trim().split("-")[0]?.toLowerCase();
  const detected = primary && LOCALES.includes(primary) ? primary : DEFAULT_LOCALE;

  const response = NextResponse.next();
  response.cookies.set("NEXT_LOCALE", detected, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return response;
}

export const config = {
  // Run on everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
