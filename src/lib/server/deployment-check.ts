import { headers } from "next/headers";
import { configProblems, type ConfigProblem } from "./config";
import { runtimeEnv } from "./env";

export type DeploymentProblem =
  | ConfigProblem
  | { name: "APP_URL"; kind: "mismatch"; expected: string; actual: string }
  | { name: "DB"; kind: "missing" | "migrations" };

// 部署後最常見的錯誤是變數沒填、格式不對或 D1 遷移沒套用；
// /setup 與 /sign-in 先檢查這些，顯示說明頁而不是無法判讀的 500。只回報名稱，不回報密鑰值。
export async function deploymentCheck(options: { encryptionKey: boolean; origin: boolean }) {
  const env = await runtimeEnv();
  const problems: DeploymentProblem[] = configProblems(env as unknown as Record<string, unknown>)
    .filter((p) => options.encryptionKey || p.name !== "CODE_ENCRYPTION_KEY");
  let installed = false;
  if (!env.DB) problems.push({ name: "DB", kind: "missing" });
  else {
    try {
      installed = Boolean(await env.DB.prepare("SELECT id FROM installation WHERE id = 1").first());
    } catch (error) {
      if (!/no such table/i.test(String(error))) throw error;
      problems.push({ name: "DB", kind: "migrations" });
    }
  }
  // 初始化 API 只接受來自 APP_URL 的請求；網址不一致時表單送出一定失敗，先在頁面說清楚。
  if (options.origin && !installed && !problems.some((p) => p.name === "APP_URL")) {
    const expected = String(env.APP_URL).trim().replace(/\/+$/, "");
    const actual = (await headers()).get("host");
    if (actual && new URL(expected).host !== actual) problems.push({ name: "APP_URL", kind: "mismatch", expected, actual });
  }
  return { problems, installed };
}
