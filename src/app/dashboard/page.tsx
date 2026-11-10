import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Boxes, Package, Receipt, TicketCheck, Wallet } from "lucide-react";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { siteFeatures } from "@/config/site";
import { readOverview } from "@/lib/server/dashboard-overview";
import { currencyDigits } from "@/lib/domain/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { ActivityChart, AttentionCard, RecentActivity, SetupChecklist, StatCard } from "@/components/dashboard/overview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/motion/card";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { ButtonLink } from "@/components/motion/button/base";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { env, settings } = await runtime();
  if (!(await env.DB.prepare("SELECT id FROM installation WHERE id = 1").first())) redirect("/setup");
  const session = await createAuth(env, settings).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!(await isAdmin(env.DB, session.user.id))) redirect(siteFeatures.myCodes ? "/my-codes" : "/");
  const [t, format, data] = await Promise.all([getTranslations("overview"), getFormatter(), readOverview(env.DB)]);
  const stripe = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
  const email = Boolean(env.EMAIL && settings.EMAIL_FROM);
  const primary = data.revenue[0];
  const steps = [
    { key: "product", done: data.setup.product, href: "/dashboard/products?new=1" },
    { key: "codes", done: data.setup.codes, href: "/dashboard/products" },
    { key: "campaign", done: data.setup.campaign, href: "/dashboard/products" },
    { key: "stripe", done: stripe, href: "/dashboard/stripe-discounts", optional: true },
    { key: "email", done: email, href: "/dashboard/notifications", optional: true },
  ];
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description", { name: session.user.name })}
        actions={
          <>
            <ButtonLink href="/dashboard/orders" variant="secondary" size="sm">{t("quick.orders")}</ButtonLink>
            <ButtonLink href="/dashboard/handout" variant="secondary" size="sm">{t("quick.handout")}</ButtonLink>
            <ButtonLink href="/dashboard/products?new=1" size="sm">{t("quick.newProduct")}</ButtonLink>
          </>
        }
      />
      <section className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4" aria-label={t("title")}>
        <StatCard label={t("stats.products")} value={data.products.active} icon={<Package />} hint={t("stats.productsHint", { count: data.products.archived })} />
        <StatCard label={t("stats.available")} value={data.codes.available} icon={<Boxes />} hint={t("stats.availableHint", { total: format.number(data.codes.total) })} />
        <StatCard label={t("stats.claims")} value={data.claims.last30} icon={<TicketCheck />} hint={t("stats.claimsHint", { count: data.claims.today })} />
        {primary ? (
          <StatCard
            label={t("stats.revenue")}
            value={primary.netMinor / 10 ** currencyDigits(primary.currency)}
            icon={<Wallet />}
            hint={`${t("stats.revenueHint")} · ${t("stats.ordersHint", { count: data.orders.review })}`}
            currency={primary.currency}
          />
        ) : (
          <StatCard label={t("stats.orders")} value={data.orders.paid30} icon={<Receipt />} hint={t("stats.ordersHint", { count: data.orders.review })} />
        )}
      </section>
      <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ActivityChart daily={data.daily} />
        <RecentActivity items={data.recent} now={data.now} />
      </section>
      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <AttentionCard attention={data.attention} />
        <SetupChecklist steps={steps} />
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("services.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { key: "stripe", ok: stripe },
              { key: "email", ok: email },
            ].map((service) => (
              <div key={service.key} className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
                <span className="font-medium">{t(`services.${service.key}`)}</span>
                <AnimatedBadge size="sm" status={service.ok ? "success" : "neutral"}>
                  {t(service.ok ? "services.connected" : "services.notConfigured")}
                </AnimatedBadge>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
