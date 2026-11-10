import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { getCampaign } from "@/lib/server/campaigns";
import { listBatches } from "@/lib/server/inventory";
import { CampaignForm, CampaignStatus } from "@/components/campaigns/campaign-form";
import { CampaignCredentials } from "@/components/campaigns/credentials";
import { listCampaignCredentials } from "@/lib/server/campaign-credentials";
import { CampaignLinks } from "@/components/campaigns/links";
import { listCampaignLinks } from "@/lib/server/claims";
import { RewardForm } from "@/components/campaigns/reward-form";
import { getRewardRule } from "@/lib/server/redemptions";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/motion/card";
import { AnimatedBadge, type AnimatedBadgeStatus } from "@/components/motion/animated-badge";
import { ButtonLink } from "@/components/motion/button/base";

export const dynamic = "force-dynamic";

const statusTone: Record<string, AnimatedBadgeStatus> = { active: "success", paused: "warning", draft: "neutral", archived: "neutral" };

export default async function EditCampaign({ params }: { params: Promise<{ id: string }> }) {
  const { env, settings } = await runtime();
  const session = await createAuth(env, settings).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!(await isAdmin(env.DB, session.user.id))) redirect("/");
  const { id } = await params;
  const campaign = await getCampaign(env.DB, id);
  if (!campaign) notFound();
  const [batches, t, format, credentials, links, reward, product] = await Promise.all([
    listBatches(env.DB, campaign.product_id),
    getTranslations(),
    getFormatter(),
    listCampaignCredentials(env.DB, id),
    listCampaignLinks(env.DB, id),
    getRewardRule(env.DB, campaign.batch_id, id),
    env.DB.prepare("SELECT name FROM products WHERE id=?").bind(campaign.product_id).first<{ name: string }>(),
  ]);
  const isRedemption = batches.find((b) => b.id === campaign.batch_id)?.kind === "redemption";
  const publicUrl = `${settings.APP_URL}/claim/${campaign.slug}`;
  return (
    <>
      <PageHeader
        crumbs={[
          { label: t("products.title"), href: "/dashboard/products" },
          { label: product?.name ?? "", href: `/dashboard/products/${campaign.product_id}` },
          { label: t("campaigns.title"), href: `/dashboard/products/${campaign.product_id}/campaigns` },
          { label: campaign.name },
        ]}
        title={campaign.name}
        meta={
          <AnimatedBadge size="sm" status={statusTone[campaign.status] ?? "neutral"} showIcon={false} pulse={campaign.status === "active"}>
            {t(`campaigns.${campaign.status}`)}
          </AnimatedBadge>
        }
        description={<span className="font-mono text-xs">/claim/{campaign.slug}</span>}
        actions={
          campaign.visibility === "public" && (
            <ButtonLink href={publicUrl} target="_blank" rel="noreferrer" variant="secondary" size="sm">
              {t("campaignPage.publicLink")} <ExternalLink className="size-3.5" aria-hidden />
            </ButtonLink>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t("campaignPage.settings")}</CardTitle>
              <CardDescription>{t("campaignPage.settingsDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <CampaignForm productId={campaign.product_id} batches={batches} campaign={campaign} />
            </CardContent>
          </Card>
          {isRedemption && (
            <Card>
              <CardContent>
                <RewardForm productId={campaign.product_id} batchId={campaign.batch_id} campaignId={id} rule={reward} />
              </CardContent>
            </Card>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t("campaigns.status")}</CardTitle>
              <CardDescription>{t("campaignPage.statusDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <CampaignStatus campaign={campaign} />
              <dl className="grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("campaignPage.claims")}</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{format.number(campaign.claimed_count)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("campaignPage.perPerson")}</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{format.number(campaign.per_person_limit)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("campaignPage.total")}</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{campaign.total_limit === null ? t("campaignPage.unlimited") : format.number(campaign.total_limit)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <CampaignLinks campaignId={id} publicUrl={publicUrl} links={links} />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <CampaignCredentials campaignId={id} credentials={credentials} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
