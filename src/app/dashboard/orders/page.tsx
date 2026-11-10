import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations, getFormatter } from "next-intl/server";
import { z } from "zod";
import { Receipt } from "lucide-react";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { listOrders, orderStatuses } from "@/lib/server/orders";
import { currencyDigits } from "@/lib/domain/money";
import { OrderAdminActions } from "@/components/checkout/order-admin-actions";
import { RefundReviewActions } from "@/components/checkout/refund-review-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { LinkTabs } from "@/components/dashboard/link-tabs";
import { PagePagination } from "@/components/dashboard/page-pagination";
import { Notice } from "@/components/dashboard/notice";
import { Card, CardContent } from "@/components/motion/card";
import { AnimatedBadge, type AnimatedBadgeStatus } from "@/components/motion/animated-badge";

export const dynamic = "force-dynamic";

const statusTone: Record<string, AnimatedBadgeStatus> = {
  fulfilled: "success",
  pending: "loading",
  expired: "neutral",
  refunded: "neutral",
  refund_pending: "warning",
  manual: "warning",
  backorder: "warning",
};

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { env, settings } = await runtime();
  const session = await createAuth(env, settings).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!(await isAdmin(env.DB, session.user.id))) redirect("/");
  const query = await searchParams;
  const page = typeof query.page === "string" && /^\d+$/.test(query.page) ? Math.min(100000, Math.max(1, Number(query.page))) : 1;
  const status = z.enum(orderStatuses).safeParse(query.status);
  const filter = status.success ? status.data : undefined;
  const [list, t, format] = await Promise.all([listOrders(env.DB, { page, status: filter }), getTranslations(), getFormatter()]);
  const money = (minor: number, currency: string) => format.number(minor / 10 ** currencyDigits(currency), { style: "currency", currency });
  return (
    <>
      <PageHeader crumbs={[{ label: t("adminOrders.title") }]} title={t("adminOrders.title")} description={t("adminOrders.description")} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <LinkTabs
          label={t("adminOrders.filter")}
          value={filter ?? "all"}
          items={[
            { value: "all", label: t("adminOrders.all"), href: "/dashboard/orders" },
            ...orderStatuses.map((s) => ({ value: s, label: t(`adminOrders.status.${s}`), href: `/dashboard/orders?status=${s}` })),
          ]}
        />
        <p className="text-sm text-muted-foreground">{t("adminOrders.total", { count: list.total })}</p>
      </div>
      {list.orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
              <Receipt className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">{t("adminOrders.empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.orders.map((order) => {
            const revoked = order.access_revoked_at !== null || order.code_status === "revoked";
            return (
              <Card key={order.id} size="compact" className="gap-4">
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/dashboard/products/${order.product_id}`} className="text-sm font-semibold hover:underline">
                          {order.product_name}
                        </Link>
                        <AnimatedBadge size="sm" status={statusTone[order.status] ?? "neutral"} showIcon={false}>
                          {t(`adminOrders.status.${order.status}`)}
                        </AnimatedBadge>
                        {!!order.review_required && (
                          <AnimatedBadge size="sm" status="warning" pulse>
                            {t("adminOrders.needsReview")}
                          </AnimatedBadge>
                        )}
                      </div>
                      <p className="break-all font-mono text-xs text-muted-foreground">{order.id}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-semibold tabular-nums">{money(order.amount_minor, order.currency)}</p>
                      <p className="text-xs text-muted-foreground">{format.dateTime(order.created_at, { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                  </div>
                  <dl className="grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-3">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{t("adminOrders.buyer")}</dt>
                      <dd className="mt-0.5 truncate">{order.email ?? (order.user_id ? t("adminOrders.account", { id: order.user_id }) : t("adminOrders.guest"))}</dd>
                    </div>
                    {order.refunded_minor > 0 && (
                      <div>
                        <dt className="text-xs text-muted-foreground">{t("adminOrders.status.refunded")}</dt>
                        <dd className="mt-0.5 tabular-nums">{t("order.refundedAmount", { amount: money(order.refunded_minor, order.currency) })}</dd>
                      </div>
                    )}
                  </dl>
                  {revoked && <Notice variant="warning">{t("refundReview.currentRevoked")}</Notice>}
                  {!!order.review_required && <Notice variant="warning">{t("adminOrders.review")}</Notice>}
                  {!!order.review_required && order.refunded_minor > 0 && order.code_id && ["fulfilled", "refunded"].includes(order.status) && (
                    <RefundReviewActions
                      key={`${order.id}:${order.refunded_minor}:${order.access_revoked_at}:${order.code_status}`}
                      id={order.id}
                      refundedMinor={order.refunded_minor}
                      external={order.code_kind === "external"}
                      revoked={revoked}
                    />
                  )}
                  <RefundReviewRecord value={order.refund_review_json} currency={order.currency} />
                  <OrderAdminActions id={order.id} waiting={["manual", "backorder"].includes(order.status)} stripeConfigured={!!env.STRIPE_SECRET_KEY} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <PagePagination page={page} totalPages={Math.ceil(list.total / 20)} />
    </>
  );
}

async function RefundReviewRecord({ value, currency }: { value: string | null; currency: string }) {
  if (!value) return null;
  const review = JSON.parse(value) as { decision: "retain" | "revoke" | "acknowledge"; note: string; createdAt: number; adminId: string; refundedMinor: number };
  const t = await getTranslations("refundReview"), format = await getFormatter();
  return (
    <section className="space-y-2 rounded-xl bg-muted/50 p-4 text-sm" aria-label={t("record")}>
      <h3 className="font-semibold">{t("record")}</h3>
      <p>
        {t(`decisions.${review.decision}`)} · {format.dateTime(review.createdAt, { dateStyle: "medium", timeStyle: "short" })}
      </p>
      <p>{t("amount", { amount: format.number(review.refundedMinor / 10 ** currencyDigits(currency), { style: "currency", currency }) })}</p>
      <p className="whitespace-pre-wrap break-words">{review.note}</p>
      <p className="break-all text-xs text-muted-foreground">{t("reviewer", { id: review.adminId })}</p>
    </section>
  );
}
