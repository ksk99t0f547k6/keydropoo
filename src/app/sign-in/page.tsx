import { PoweredBy } from "@/components/site/powered-by";
import { BrandWordmark } from "@/components/site/brand-logo";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { runtime } from "@/lib/server/env";
import { AuthForm } from "@/components/auth/auth-form";
import { DeploymentProblems } from "@/components/auth/deployment-problems";
import { deploymentCheck } from "@/lib/server/deployment-check";
export const dynamic = "force-dynamic";
export default async function SignIn() {
  const check = await deploymentCheck({ encryptionKey: false, origin: false });
  const t = await getTranslations();
  if (check.problems.length) return <main className="auth-shell"><Link className="wordmark" href="/"><BrandWordmark label={t("common.brand")}/></Link><section className="auth-card"><DeploymentProblems problems={check.problems}/></section><PoweredBy/></main>;
  if (!check.installed) redirect("/setup");
  const { env, settings } = await runtime();
  return <main className="auth-shell"><Link className="wordmark" href="/"><BrandWordmark label={t("common.brand")}/></Link><section className="auth-card"><h1>{t("auth.title")}</h1><p className="intro">{t("auth.description")}</p><AuthForm emailEnabled={Boolean(env.EMAIL && settings.EMAIL_FROM)} /></section><PoweredBy/></main>;
}
