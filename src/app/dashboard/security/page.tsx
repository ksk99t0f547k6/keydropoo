import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { signInLink } from "@/lib/domain/auth-navigation";
import { SecurityPanel } from "@/components/account/security-panel";
import { readSecurityState } from "@/lib/server/password-settings";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/motion/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

// 管理員在控制台裡管理自己的密碼；一般使用者仍走 /account/security。
export default async function DashboardSecurity() {
  const { env, settings } = await runtime();
  const session = await createAuth(env, settings).api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
  if (!session) redirect(signInLink("/dashboard/security"));
  if (!(await isAdmin(env.DB, session.user.id))) redirect("/account/security");
  const t = await getTranslations();
  return (
    <>
      <PageHeader crumbs={[{ label: t("security.title") }]} title={t("security.title")} description={t("security.description")} />
      <Card className="max-w-xl">
        <CardContent>
          <SecurityPanel state={await readSecurityState(env.DB, session.user, session.session.createdAt, Boolean(env.EMAIL && settings.EMAIL_FROM))} returnTo="/dashboard/security" />
        </CardContent>
      </Card>
    </>
  );
}
