import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readSettings } from "./config";

export interface EmailSender {
  send(message: { to: string; from: string; subject: string; text: string }): Promise<unknown>;
}
// 以應用實際使用的結構化寄信介面取代產生型別中的多載，避免選配 EMAIL 後交集改變測試與轉接器的參數型別。
export type RuntimeEnv = Omit<CloudflareEnv, "EMAIL"> & {
  APP_URL?: string;
  ADMIN_EMAIL?: string;
  BETTER_AUTH_SECRET?: string;
  SETUP_SECRET?: string;
  WEBHOOK_SECRETS?: string;
  EXTERNAL_REWARD_SECRETS?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_SYNC_BATCH_SIZE?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  EMAIL_FROM?: string;
  ELIGIBILITY_SECRETS?: string;
  CODE_ENCRYPTION_KEY?: string;
  EMAIL?: EmailSender;
};
// 讀取原始綁定，尚未檢查必要設定；一般情況請用 runtime()。
export async function runtimeEnv() {
  const { env } = await getCloudflareContext({ async: true });
  const bindings = { ...env } as RuntimeEnv;
  // OpenNext 開發代理不載入 .env；只在開發環境補入指定的伺服器變數。
  if (process.env.NODE_ENV === "development") {
    for (const key of ["APP_URL", "ADMIN_EMAIL", "BETTER_AUTH_SECRET", "SETUP_SECRET", "EMAIL_FROM", "CODE_ENCRYPTION_KEY", "ELIGIBILITY_SECRETS", "WEBHOOK_SECRETS","EXTERNAL_REWARD_SECRETS","STRIPE_SECRET_KEY", "STRIPE_SYNC_BATCH_SIZE", "STRIPE_WEBHOOK_SECRET"] as const) {
      if (process.env[key] !== undefined) bindings[key] = process.env[key];
    }
  }
  return bindings;
}
export async function runtime() {
  const bindings = await runtimeEnv();
  return { env: bindings, settings: readSettings(bindings as unknown as Record<string, unknown>) };
}
