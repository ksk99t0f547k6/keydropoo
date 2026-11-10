"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight, Check, Circle } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { AnimatedBadge, type AnimatedBadgeStatus } from "@/components/motion/animated-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/motion/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  currency,
}: {
  label: string;
  value: number;
  hint?: ReactNode;
  icon?: ReactNode;
  currency?: string;
}) {
  const formatter = useFormatter();
  const format = (n: number) => (currency ? formatter.number(n, { style: "currency", currency }) : formatter.number(Math.round(n)));
  return (
    <Card size="compact" className="gap-3">
      <CardHeader>
        <CardDescription className="text-[13px] font-medium">{label}</CardDescription>
        {icon && <CardAction className="text-muted-foreground [&_svg]:size-4" aria-hidden>{icon}</CardAction>}
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold leading-none tracking-tight tabular-nums md:text-[28px]">
          <AnimatedNumber value={value} format={format} />
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function ActivityChart({ daily }: { daily: { day: number; claims: number; orders: number }[] }) {
  const t = useTranslations("overview.activity");
  const format = useFormatter();
  const categories = daily.map((point) => format.dateTime(point.day, { month: "short", day: "numeric", timeZone: "UTC" }));
  const empty = daily.every((point) => point.claims === 0 && point.orders === 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle as="h2">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="grid h-56 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <BarChart
            label={t("title")}
            categories={categories}
            layout="stacked"
            formatValue={(value) => format.number(value)}
            formatTick={(value) => format.number(value)}
            series={[
              { id: "claims", name: t("claims"), color: "var(--chart-1)", values: daily.map((point) => point.claims) },
              { id: "orders", name: t("orders"), color: "var(--chart-2)", values: daily.map((point) => point.orders) },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

const orderStatus: Record<string, AnimatedBadgeStatus> = {
  fulfilled: "success",
  pending: "neutral",
  refunded: "neutral",
  refund_pending: "warning",
  manual: "warning",
  backorder: "warning",
};

export function RecentActivity({
  items,
  now,
}: {
  now: number;
  items: { kind: "claim" | "order"; id: string; productId: string; productName: string; label: string | null; at: number; status: string | null }[];
}) {
  const t = useTranslations("overview.recent");
  const orders = useTranslations("adminOrders.status");
  const format = useFormatter();
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle as="h2">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="-mx-2 divide-y divide-border">
            {items.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <Link
                  href={item.kind === "order" ? `/dashboard/orders` : `/dashboard/products/${item.productId}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold", item.kind === "order" ? "bg-[color-mix(in_oklab,var(--chart-2)_18%,transparent)]" : "bg-[color-mix(in_oklab,var(--chart-1)_18%,transparent)]")} aria-hidden>
                    {item.kind === "order" ? "$" : "↘"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.productName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.kind === "claim" ? `${t("claim")} · ${item.label ?? ""}` : t("order")} · {format.relativeTime(item.at, now)}
                    </span>
                  </span>
                  {item.kind === "order" && item.status && (
                    <AnimatedBadge size="sm" status={orderStatus[item.status] ?? "neutral"} showIcon={false}>
                      {orders(item.status)}
                    </AnimatedBadge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/dashboard/orders" className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          {t("viewOrders")} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

export function AttentionCard({ attention }: { attention: { notifications: number; reviews: number; revocations: number; orders: number } }) {
  const t = useTranslations("overview.attention");
  const rows = [
    { key: "notifications", count: attention.notifications, href: "/dashboard/notifications" },
    { key: "reviews", count: attention.reviews, href: "/dashboard/external-reviews" },
    { key: "revocations", count: attention.revocations, href: "/dashboard/external-revocations" },
    { key: "orders", count: attention.orders, href: "/dashboard/orders" },
  ].filter((row) => row.count > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 text-sm">
            <AnimatedBadge size="sm" status="success" aria-hidden />
            <span className="text-muted-foreground">{t("clear")}</span>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.key}>
                <Link href={row.href} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm transition-colors hover:bg-muted/60">
                  <span className="flex items-center gap-3">
                    <AnimatedBadge size="sm" status="warning" pulse aria-hidden />
                    {t(row.key, { count: row.count })}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    {t("open")} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function SetupChecklist({ steps }: { steps: { key: string; done: boolean; href: string; optional?: boolean }[] }) {
  const t = useTranslations("overview.setup");
  const done = steps.filter((step) => step.done).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <CardAction>
          <span className="text-sm tabular-nums text-muted-foreground">
            {done}/{steps.length}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ul className="space-y-1">
          {steps.map((step) => (
            <li key={step.key}>
              <Link href={step.href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/60">
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", step.done ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent")} aria-hidden>
                  {step.done ? <Check className="size-3" /> : <Circle className="size-2" />}
                </span>
                <span className={cn("flex-1", step.done && "text-muted-foreground line-through decoration-border")}>{t(step.key)}</span>
                {step.done ? <span className="sr-only">{t("done")}</span> : step.optional && <span className="text-xs text-muted-foreground">{t("optional")}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
