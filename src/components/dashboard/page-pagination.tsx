"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pagination } from "@/components/motion/pagination";

// 用網址參數換頁的 beUI 分頁；保留其他篩選條件。
export function PagePagination({ page, totalPages, param = "page", className }: { page: number; totalPages: number; param?: string; className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("shell");
  if (totalPages <= 1) return null;
  const href = (target: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, String(target));
    return `${pathname}?${next}`;
  };
  return (
    <div className={className ?? "mt-6 flex justify-center"}>
      <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} getHref={href} aria-label={t("pagination")} />
    </div>
  );
}

// 只知道「還有下一頁」時的簡易上一頁／下一頁。
export function PrevNext({ page, hasMore, param = "page" }: { page: number; hasMore: boolean; param?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("shell");
  if (page <= 1 && !hasMore) return null;
  const href = (target: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, String(target));
    return `${pathname}?${next}`;
  };
  const control = "inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted";
  return (
    <nav className="mt-6 flex items-center justify-center gap-3 text-sm" aria-label={t("pagination")}>
      {page > 1 ? <Link className={control} href={href(page - 1)}>{t("previous")}</Link> : <span className={`${control} pointer-events-none opacity-40`}>{t("previous")}</span>}
      <span className="tabular-nums text-muted-foreground">{t("page", { page })}</span>
      {hasMore ? <Link className={control} href={href(page + 1)}>{t("next")}</Link> : <span className={`${control} pointer-events-none opacity-40`}>{t("next")}</span>}
    </nav>
  );
}
