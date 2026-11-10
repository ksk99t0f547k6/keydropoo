"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/motion/select";
import { LOCALE_COOKIE, localeNames, locales, localizedPath, splitLocalePath, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

// 切換介面語言：寫入 cookie；一般頁面整頁重新載入（網址不變），語言網址則換成新語言的網址。
export function LanguageSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  return (
    <div className={cn("min-w-0", className)}>
      <Select
        value={locale}
        disabled={pending}
        onValueChange={(next) => {
          document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
          // 在語言網址（/ja/…）底下時換成新語言的網址，其他頁面只重新整理。
          const { locale: prefix, path } = splitLocalePath(window.location.pathname);
          // 換語言會改變 <html lang/dir> 與整份文案，用整頁載入，避免沿用舊的根版面。
          startTransition(() => {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 必須整頁載入才能換掉根版面的 lang／dir。
            if (prefix) window.location.assign(`${localizedPath(next as Locale, path)}${window.location.search}`);
            else window.location.reload();
          });
        }}
      >
        <SelectTrigger className={cn("h-9 min-w-0 gap-1.5 rounded-lg px-2.5", compact && "max-sm:[&>span:last-child]:hidden")}>
          <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">{t("language")}: </span>
          <SelectValue className={cn("min-w-0 flex-1 truncate text-start", compact && "hidden sm:block")} />
        </SelectTrigger>
        <SelectContent>
          {locales.map((item) => (
            <SelectItem key={item} value={item}>
              {localeNames[item]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
