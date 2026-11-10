import { requestLocale } from "@/i18n/server-locale";

// 記住使用者目前的介面語言，排程寄出的碼信與管理員通知就用這個語言。只有語言改變時才寫入。
export async function rememberUserLocale(db: D1Database, user: { id: string; locale?: string | null }) {
  const locale = await requestLocale();
  if (user.locale === locale) return locale;
  await db.prepare('UPDATE "user" SET locale=? WHERE id=? AND locale IS NOT ?').bind(locale, user.id, locale).run();
  return locale;
}
