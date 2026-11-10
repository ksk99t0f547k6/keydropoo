import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { handoutSources, listHandouts } from "@/lib/server/handouts";
import { PageHeader } from "@/components/dashboard/page-header";
import { HandoutDesk } from "@/components/handout/handout-desk";
import { InstallHint } from "@/components/handout/install-hint";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("handout");
  return { ...metadata, title: t("title") };
}
const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  // 讓這頁可以加到手機主畫面、全螢幕開啟。
  manifest: "/handout.webmanifest",
  appleWebApp: { capable: true, title: "Keydrop", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#141413" },
  ],
};

export default async function Handout() {
  const { env, settings } = await runtime();
  const session = await createAuth(env, settings).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!(await isAdmin(env.DB, session.user.id))) redirect("/");
  const [t, common, sources] = await Promise.all([getTranslations("handout"), getTranslations("common"), handoutSources(env.DB)]);
  const ready = Boolean(env.CODE_ENCRYPTION_KEY);
  const initial = ready ? await listHandouts(env.DB, env.CODE_ENCRYPTION_KEY!, {}) : { items: [], hasMore: false };
  return (
    <>
      <PageHeader crumbs={[{ label: t("title") }]} title={t("title")} description={t("description")} />
      <InstallHint />
      <HandoutDesk sources={sources} initial={{ items: initial.items, hasMore: initial.hasMore }} brand={common("brand")} ready={ready} />
    </>
  );
}
