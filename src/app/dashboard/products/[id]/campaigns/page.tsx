import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronRight, Globe, Lock, Megaphone } from "lucide-react";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { listBatches } from "@/lib/server/inventory";
import { listCampaigns } from "@/lib/server/campaigns";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { SectionTitle } from "@/components/dashboard/page-header";
import { FormDrawer } from "@/components/dashboard/form-drawer";
import { PagePagination } from "@/components/dashboard/page-pagination";
import { Notice } from "@/components/dashboard/notice";
import { Card } from "@/components/motion/card";
import { AnimatedBadge, type AnimatedBadgeStatus } from "@/components/motion/animated-badge";

export const dynamic = "force-dynamic";

const statusTone: Record<string, AnimatedBadgeStatus> = { active: "success", paused: "warning", draft: "neutral", archived: "neutral" };

export default async function Campaigns({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { env, settings } = await runtime();
  const session = await createAuth(env, settings).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!(await isAdmin(env.DB, session.user.id))) redirect("/");
  const { id } = await params;
  const product = await env.DB.prepare("SELECT name,archived_at FROM products WHERE id=?").bind(id).first<{ name: string; archived_at: number | null }>();
  if (!product) notFound();
  const { page: rawPage } = await searchParams;
  const page = rawPage && /^\d+$/.test(rawPage) ? Math.min(100000, Math.max(1, Number(rawPage))) : 1;
  const [batches, list, t, format] = await Promise.all([listBatches(env.DB, id), listCampaigns(env.DB, { productId: id, page }), getTranslations(), getFormatter()]);
  const canCreate = product.archived_at === null && batches.length > 0;
  return (
    <>
      <SectionTitle
        title={t("campaigns.title")}
        description={t("productNav.campaignsDescription")}
        actions={
          <FormDrawer label={t("productNav.newCampaign")} title={t("campaigns.create")} wide disabled={!canCreate}>
            <CampaignForm productId={id} batches={batches} />
          </FormDrawer>
        }
      />
      {product.archived_at !== null ? (
        <Notice variant="warning" className="mb-4">{t("products.archivedHint")}</Notice>
      ) : (
        !batches.length && <Notice variant="info" className="mb-4">{t("campaigns.needsBatch")}</Notice>
      )}
      <Card size="compact" className="gap-0 py-0">
        {list.campaigns.length ? (
          <ul className="divide-y divide-border">
            {list.campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link href={`/dashboard/campaigns/${campaign.id}`} className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/50">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground" aria-hidden>
                    <Megaphone className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{campaign.name}</span>
                      {campaign.visibility === "private" ? <Lock className="size-3.5 text-muted-foreground" aria-label={t("campaigns.private")} /> : <Globe className="size-3.5 text-muted-foreground" aria-hidden />}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">/claim/{campaign.slug}</span>
                  </span>
                  <span className="hidden w-32 text-right text-sm tabular-nums text-muted-foreground sm:block">
                    {t("productNav.claimedOf", { claimed: format.number(campaign.claimed_count) })}
                  </span>
                  <AnimatedBadge size="sm" status={statusTone[campaign.status] ?? "neutral"} showIcon={false} pulse={campaign.status === "active"}>
                    {t(`campaigns.${campaign.status}`)}
                  </AnimatedBadge>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
              <Megaphone className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">{t("campaigns.empty")}</p>
          </div>
        )}
      </Card>
      <PagePagination page={page} totalPages={Math.ceil(list.total / 20)} />
    </>
  );
}
