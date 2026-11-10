import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeUserName } from "../src/lib/domain/user-name";
import { initialize, setupInput } from "../src/lib/server/bootstrap";
import { createAuth } from "../src/lib/server/auth";
import { readSettings, type Settings } from "../src/lib/server/config";
import type { RuntimeEnv } from "../src/lib/server/env";
import { testDatabase } from "./d1";

describe("normalizeUserName", () => {
  it("去掉前後空白並合併連續空白", () => {
    expect(normalizeUserName("  Alex   Admin \n")).toBe("Alex Admin");
  });

  it("接受各種語言與 emoji，以字元數計算長度", () => {
    expect(normalizeUserName("陳家民")).toBe("陳家民");
    expect(normalizeUserName("😀".repeat(100))).toBe("😀".repeat(100));
    expect(normalizeUserName("😀".repeat(101))).toBeNull();
  });

  it("拒絕空白、過長、非字串與控制或格式字元", () => {
    expect(normalizeUserName("   ")).toBeNull();
    expect(normalizeUserName("a".repeat(101))).toBeNull();
    expect(normalizeUserName(42)).toBeNull();
    expect(normalizeUserName("bad\u0000name")).toBeNull();
    expect(normalizeUserName("admin\u202Egnp.exe")).toBeNull();
    expect(normalizeUserName("zero\u200Bwidth")).toBeNull();
  });
});

describe("setupInput 名稱", () => {
  const base = { secret: "s".repeat(32), password: "p".repeat(12) };

  it("初始化與帳號頁用同一套規則", () => {
    const parsed = setupInput.safeParse({ ...base, name: "  Alex  Admin " });
    expect(parsed.success && parsed.data.name).toBe("Alex Admin");
    expect(setupInput.safeParse({ ...base, name: "x\u202Ey" }).success).toBe(false);
    expect(setupInput.safeParse({ ...base, name: " " }).success).toBe(false);
  });
});

describe("透過 Better Auth 修改名稱", () => {
  const origin = "http://localhost:3000";
  const email = "owner@example.test";
  const password = "fixture-original-password";
  let database: ReturnType<typeof testDatabase>;
  let auth: ReturnType<typeof createAuth>;
  let settings: Settings;
  let n = 0;
  beforeEach(async () => {
    database = testDatabase();
    settings = readSettings({ APP_URL: origin, ADMIN_EMAIL: email, BETTER_AUTH_SECRET: "fixture-auth-secret-for-name-tests-000032", SETUP_SECRET: "fixture-setup-secret-for-name-tests-00000032" });
    await initialize(database.db, settings, { name: "Owner", password, secret: settings.SETUP_SECRET });
    auth = createAuth({ DB: database.db } as RuntimeEnv, settings);
  });
  afterEach(() => database.sqlite.close());
  const call = (path: string, body: unknown, cookie = "") =>
    auth.handler(new Request(`${origin}/api/auth/${path}`, { method: "POST", headers: { origin, "Content-Type": "application/json", cookie, "cf-connecting-ip": `192.0.2.${++n}` }, body: JSON.stringify(body) }));
  const stored = () => database.sqlite.prepare('SELECT name, image FROM "user" WHERE email = ?').get(email) as { name: string; image: string | null };

  it("正規化後寫入，拒絕不合法名稱與頭像", async () => {
    const signIn = await call("sign-in/email", { email, password });
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect((await call("update-user", { name: "  Eric   Chen " }, cookie)).status).toBe(200);
    expect(stored().name).toBe("Eric Chen");
    for (const name of ["   ", "a".repeat(101), "admin\u202Egnp.exe"]) {
      const response = await call("update-user", { name }, cookie);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { message?: string }).message).toBe("INVALID_NAME");
    }
    expect((await call("update-user", { image: "https://example.com/x.png" }, cookie)).status).toBe(400);
    expect(stored()).toEqual({ name: "Eric Chen", image: null });
    expect((await call("update-user", { name: "Someone" })).status).toBe(401);
  });
});
