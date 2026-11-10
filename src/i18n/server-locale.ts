import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, LOCALE_HEADER, matchLocale, type Locale } from "./locales";

// 這次請求的介面語言：網址前綴（由 proxy 帶入）> 語言選單 cookie > 瀏覽器 Accept-Language。
export function resolveLocale(input: { urlLocale?: string | null; cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.urlLocale)) return input.urlLocale;
  if (isLocale(input.cookie)) return input.cookie;
  return matchLocale(input.acceptLanguage);
}

// 在請求之外（排程、測試）呼叫時回傳預設語言。
export async function requestLocale(): Promise<Locale> {
  try {
    const requestHeaders = await headers();
    return resolveLocale({
      urlLocale: requestHeaders.get(LOCALE_HEADER),
      cookie: (await cookies()).get(LOCALE_COOKIE)?.value,
      acceptLanguage: requestHeaders.get("accept-language"),
    });
  } catch {
    return defaultLocale;
  }
}
