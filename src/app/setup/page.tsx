import { PoweredBy } from "@/components/site/powered-by";
import { BrandWordmark } from "@/components/site/brand-logo";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/auth-form";
import { DeploymentProblems } from "@/components/auth/deployment-problems";
import { deploymentCheck } from "@/lib/server/deployment-check";
export const dynamic = "force-dynamic";
export default async function Setup() {
  const check = await deploymentCheck({ encryptionKey: true, origin: true });
  if (check.installed) redirect("/sign-in");
  const t = await getTranslations();
  return <main className="auth-shell"><Link className="wordmark" href="/"><BrandWordmark label={t("common.brand")}/></Link><section className="auth-card">{check.problems.length ? <DeploymentProblems problems={check.problems}/> : <><h1>{t("setup.title")}</h1><p className="intro">{t("setup.description")}</p><AuthForm setup /></>}</section><PoweredBy/></main>;
}
