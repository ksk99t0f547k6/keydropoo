import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { siteFeatures } from "@/config/site";
import { DashboardShell } from "@/components/dashboard/shell";
import { rememberUserLocale } from "@/lib/server/user-locale";
import { mono, sans } from "@/lib/fonts";


export const dynamic = "force-dynamic";

// 控制台共用外框。權限在這裡先擋一次，各頁仍保留自己的檢查。
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { env, settings } = await runtime();
  if (!(await env.DB.prepare("SELECT id FROM installation WHERE id = 1").first())) redirect("/setup");
  const session = await createAuth(env, settings).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!(await isAdmin(env.DB, session.user.id))) redirect(siteFeatures.myCodes ? "/my-codes" : "/");
  await rememberUserLocale(env.DB, session.user);
  const counts = await env.DB.prepare(
    `SELECT (SELECT count(*) FROM admin_notifications WHERE resolved_at IS NULL) AS notifications,
     (SELECT count(*) FROM external_redemption_attempts WHERE review_required=1) AS reviews,
     (SELECT count(*) FROM external_revocations WHERE status='failed') AS revocations`,
  ).first<{ notifications: number; reviews: number; revocations: number }>();
  return (
    <div className={`${sans.variable} ${mono.variable}`}>
      <DashboardShell
        user={{ name: session.user.name, email: session.user.email }}
        counts={{ notifications: counts?.notifications ?? 0, reviews: counts?.reviews ?? 0, revocations: counts?.revocations ?? 0 }}
      >
        {children}
      </DashboardShell>
    </div>
  );
}
