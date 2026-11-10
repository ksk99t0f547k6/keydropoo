import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { Settings } from "./config";
import { normalizeUserName } from "@/lib/domain/user-name";

export const setupInput = z.object({ secret: z.string().min(32).max(512), password: z.string().min(12).max(128), name: z.string().max(400).transform((value, ctx) => normalizeUserName(value) ?? (ctx.addIssue({ code: "custom", message: "INVALID_NAME" }), z.NEVER)) });
export class SetupError extends Error {
  constructor(public code: "INVALID_SECRET" | "ALREADY_INITIALIZED") { super(code); }
}
export async function secretEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const [left, right] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const l = new Uint8Array(left); const r = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < l.length; i++) diff |= l[i] ^ r[i];
  return diff === 0;
}
export async function initialize(db: D1Database, settings: Settings, input: z.infer<typeof setupInput>) {
  if (!await secretEqual(input.secret, settings.SETUP_SECRET)) throw new SetupError("INVALID_SECRET");
  if (await db.prepare("SELECT id FROM installation WHERE id = 1").first()) throw new SetupError("ALREADY_INITIALIZED");
  const userId = crypto.randomUUID();
  const now = Date.now();
  const password = await hashPassword(input.password);
  try {
    // D1 batch 整批交易；單例主鍵讓競爭中的第二次初始化整批回滾。
    await db.batch([
      db.prepare("INSERT INTO installation (id, admin_user_id, created_at) VALUES (1, ?, ?)").bind(userId, now),
      db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)').bind(userId, input.name, settings.ADMIN_EMAIL, now, now),
      db.prepare('INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, \'credential\', ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, userId, password, now, now),
    ]);
  } catch (error) {
    if (await db.prepare("SELECT id FROM installation WHERE id = 1").first()) throw new SetupError("ALREADY_INITIALIZED");
    throw error;
  }
  return { userId };
}
