import { z } from "zod";

// 部署時常把 APP_URL 填成帶結尾斜線的網址；只去掉結尾斜線，其他路徑仍視為錯誤。
const appUrl = z.preprocess((v) => (typeof v === "string" ? v.trim().replace(/\/+$/, "") : v), z.url().refine((v) => {
  const u = new URL(v);
  return u.origin === v && (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)));
}));

const schema = z.object({
  APP_URL: appUrl,
  ADMIN_EMAIL: z.email().transform((v) => v.toLowerCase()),
  BETTER_AUTH_SECRET: z.string().min(32),
  SETUP_SECRET: z.string().min(32),
  EMAIL_FROM: z.email().optional(),
});

export type Settings = z.infer<typeof schema>;
export type ConfigProblem = { name: string; kind: "missing" | "invalid" };

// 設定錯誤只帶欄位名稱，絕不帶入密鑰值；頁面據此顯示設定說明，不再變成無法判讀的 500。
export class ConfigError extends Error {
  constructor(readonly problems: ConfigProblem[]) {
    super(`Configuration required: ${problems.map((p) => p.name).join(", ")}`);
    this.name = "ConfigError";
  }
}

function problemsOf(issues: z.core.$ZodIssue[], env: Record<string, unknown>): ConfigProblem[] {
  const names = [...new Set(issues.map((i) => String(i.path[0])))];
  return names.map((name) => ({ name, kind: env[name] === undefined || env[name] === "" ? "missing" : "invalid" }));
}

export function readSettings(env: Record<string, unknown>): Settings {
  const result = schema.safeParse(env);
  if (!result.success) throw new ConfigError(problemsOf(result.error.issues, env));
  return result.data;
}

// 列出所有必要設定的問題（含碼庫加密金鑰），供 /setup、/sign-in 的說明頁使用。
export function configProblems(env: Record<string, unknown>): ConfigProblem[] {
  const result = schema.safeParse(env);
  const problems = result.success ? [] : problemsOf(result.error.issues, env);
  const key = env.CODE_ENCRYPTION_KEY;
  if (key === undefined || key === "") problems.push({ name: "CODE_ENCRYPTION_KEY", kind: "missing" });
  else if (typeof key !== "string" || !/^[a-f0-9]{64}$/i.test(key)) problems.push({ name: "CODE_ENCRYPTION_KEY", kind: "invalid" });
  return problems;
}
