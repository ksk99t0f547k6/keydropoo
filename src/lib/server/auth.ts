import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { D1Dialect } from "kysely-d1";
import type { RuntimeEnv } from "./env";
import type { Settings } from "./config";
import { loadMessages } from "@/i18n/messages";
import { requestLocale } from "@/i18n/server-locale";
import { normalizeUserName } from "@/lib/domain/user-name";

export function createAuth(env: RuntimeEnv, settings: Settings) {
  const mailEnabled = Boolean(env.EMAIL && settings.EMAIL_FROM);
  return betterAuth({
    appName: "Keydrop",
    baseURL: settings.APP_URL,
    secret: settings.BETTER_AUTH_SECRET,
    // 正式入口是 Cloudflare Workers；只信任 Cloudflare 覆寫的來源 IP 標頭。
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    database: { dialect: new D1Dialect({ database: env.DB }), type: "sqlite", transaction: false },
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    // 使用者偏好的介面語言，排程郵件用；只能由伺服器寫入。
    user: { additionalFields: { locale: { type: "string", required: false, input: false } } },
    databaseHooks: {
      user: { create: { before: async (user) => {
        const initialized = await env.DB.prepare("SELECT id FROM installation WHERE id = 1").first();
        if (!initialized || user.email.toLowerCase() === settings.ADMIN_EMAIL) throw new APIError("FORBIDDEN", { message: "REGISTRATION_UNAVAILABLE" });
        const name = normalizeUserName(user.name);
        if (name === null) throw new APIError("BAD_REQUEST", { message: "INVALID_NAME" });
        return { data: { ...user, name } };
      } },
      // 使用者可自行改顯示名稱（/api/auth/update-user）；不提供頭像，拒絕寫入 image。
      update: { before: async (data) => {
        if (data.image !== undefined) throw new APIError("BAD_REQUEST", { message: "IMAGE_NOT_SUPPORTED" });
        if (data.name === undefined) return { data };
        const name = normalizeUserName(data.name);
        if (name === null) throw new APIError("BAD_REQUEST", { message: "INVALID_NAME" });
        return { data: { ...data, name } };
      } } },
      // 登入時記住當下的介面語言。
      session: { create: { after: async (session) => {
        const locale = await requestLocale();
        await env.DB.prepare('UPDATE "user" SET locale=? WHERE id=? AND locale IS NOT ?').bind(locale, session.userId, locale).run();
      } } },
    },
    plugins: mailEnabled ? [emailOTP({
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp, type }) {
        const reset=type==='forget-password';
        // 驗證碼信用要求寄信的這個請求的介面語言。
        const messages=await loadMessages(await requestLocale());
        await env.EMAIL!.send({ to: email, from: settings.EMAIL_FROM!, subject: reset?messages.email.passwordResetSubject:messages.email.otpSubject, text: (reset?messages.email.passwordResetBody:messages.email.otpBody).replace("{otp}", otp) });
      },
    })] : [],
  });
}
export async function isAdmin(db: D1Database, userId: string) {
  return Boolean(await db.prepare("SELECT id FROM installation WHERE id = 1 AND admin_user_id = ?").bind(userId).first());
}
