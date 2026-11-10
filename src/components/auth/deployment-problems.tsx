import { getTranslations } from "next-intl/server";
import type { DeploymentProblem } from "@/lib/server/deployment-check";

const hintKey: Record<string, string> = {
  APP_URL: "hints.appUrl",
  ADMIN_EMAIL: "hints.adminEmail",
  BETTER_AUTH_SECRET: "hints.secret",
  SETUP_SECRET: "hints.secret",
  EMAIL_FROM: "hints.emailFrom",
  CODE_ENCRYPTION_KEY: "hints.encryptionKey",
};

// 部署設定不完整時的說明頁內容：列出變數名稱與修正方式，不顯示任何密鑰值。
export async function DeploymentProblems({ problems }: { problems: DeploymentProblem[] }) {
  const t = await getTranslations("deploymentCheck");
  return <>
    <h1>{t("title")}</h1>
    <p className="intro">{t("description")}</p>
    <ul className="deployment-problems" role="list">
      {problems.map((p) => {
        const key = `${p.name}-${p.kind}`;
        if (p.kind === "migrations") return <li key={key}><code>D1</code><p>{t("migrations")}</p></li>;
        if (p.kind === "mismatch") return <li key={key}><code>APP_URL</code><p>{t("mismatch", { expected: p.expected, actual: p.actual })}</p></li>;
        if (p.name === "DB") return <li key={key}><code>DB</code><p>{t("database")}</p></li>;
        return <li key={key}><code>{p.name}</code><p>{t(p.kind)}{hintKey[p.name] ? ` ${t(hintKey[p.name])}` : ""}</p></li>;
      })}
    </ul>
    <p className="intro">{t("where")}</p>
  </>;
}
