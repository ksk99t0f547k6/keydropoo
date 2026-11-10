// 支援的介面語言。新增語言時：在這裡加代碼與名稱，並新增 messages/<代碼>.json（鍵與英文版完全相同）。
export const locales = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "it", "de", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const rtlLocales: readonly Locale[] = ["ar"];
// 語言選單顯示各語言的自稱。
export const localeNames: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  it: "Italiano",
  de: "Deutsch",
  ar: "العربية",
};
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

// 依 Accept-Language 挑最接近的支援語言；中文依地區或字形對應簡繁。
export function matchLocale(header: string | null | undefined): Locale {
  if (!header) return defaultLocale;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split("=")[1]) || 0 : 1 };
    })
    .filter((item) => item.tag && item.tag !== "*" && item.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (tag.startsWith("zh")) {
      if (/hant|-tw|-hk|-mo/.test(tag)) return "zh-Hant";
      return "zh-Hans";
    }
    const base = tag.split("-")[0];
    const found = locales.find((locale) => locale.toLowerCase() === tag || locale.toLowerCase() === base);
    if (found) return found;
  }
  return defaultLocale;
}

// 網址語言前綴，例如 /ja/features。英文也接受 /en/…；不帶前綴的網址依 cookie 或瀏覽器語言顯示。
export const LOCALE_HEADER = "x-keydrop-locale";

export function splitLocalePath(pathname: string): { locale: Locale | null; path: string } {
  const match = /^\/([A-Za-z]{2}(?:-[A-Za-z]{4})?)(\/.*)?$/.exec(pathname);
  const locale = match ? locales.find((item) => item.toLowerCase() === match[1].toLowerCase()) ?? null : null;
  return locale ? { locale, path: match?.[2] || "/" } : { locale: null, path: pathname };
}

// 加上語言前綴；null 代表不加前綴。
export function localizedPath(locale: Locale | null, path: string) {
  if (!locale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

// Open Graph 用的語系代碼。
export const ogLocales: Record<Locale, string> = {
  en: "en_US", "zh-Hans": "zh_CN", "zh-Hant": "zh_TW", ja: "ja_JP", ko: "ko_KR", it: "it_IT", de: "de_DE", ar: "ar_AR",
};
