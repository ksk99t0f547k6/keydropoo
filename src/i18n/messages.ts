import english from "../../messages/en.json";
import { defaultLocale, isLocale, type Locale } from "./locales";

export type Messages = typeof english;
type Tree = { [key: string]: string | Tree };

// 翻譯缺鍵時退回英文，避免新增文案還沒翻譯時畫面或郵件出錯。
function withFallback(base: Tree, override: Tree): Tree {
  const result: Tree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const fallback = base[key];
    result[key] = typeof value === "object" && typeof fallback === "object" ? withFallback(fallback, value) : value;
  }
  return result;
}

export async function loadMessages(locale: Locale | string | null | undefined): Promise<Messages> {
  if (!isLocale(locale) || locale === defaultLocale) return english;
  try {
    const messages = (await import(`../../messages/${locale}.json`)).default as Tree;
    return withFallback(english as unknown as Tree, messages) as unknown as Messages;
  } catch {
    // 翻譯檔不存在或格式錯誤時整份退回英文，而不是讓頁面或郵件壞掉。
    return english;
  }
}
