import { describe, it, expect } from "vitest";
import { initialize, secretEqual } from "../src/lib/server/bootstrap";
import { ConfigError, configProblems, readSettings } from "../src/lib/server/config";
import { createAuth, isAdmin } from "../src/lib/server/auth";
import { testDatabase } from "./d1";
import type { RuntimeEnv } from "../src/lib/server/env";

const settings = readSettings({ APP_URL: "http://localhost:3000", ADMIN_EMAIL: "Admin@example.test", BETTER_AUTH_SECRET: "test-only-auth-secret-not-for-production-123", SETUP_SECRET: "test-only-setup-secret-not-for-production-123" });
const input = { name: "Owner", secret: settings.SETUP_SECRET, password: "test-password-1234" };
const authRequest = (path: string, body: unknown) => new Request(`${settings.APP_URL}/api/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json", origin: settings.APP_URL }, body: JSON.stringify(body) });

it("登入限流按 Cloudflare IP 分開計數，偽造轉送標頭不能重設限額",async()=>{
 const {db,sqlite}=testDatabase();
 try{
  const auth=createAuth({DB:db} as RuntimeEnv,settings);
  const attempt=async(ip:string,forwarded:string)=>{
   const request=authRequest('sign-in/email',{email:'missing@example.test',password:input.password});
   request.headers.set('cf-connecting-ip',ip);request.headers.set('x-forwarded-for',forwarded);
   return auth.handler(request);
  };
  for(let n=0;n<3;n++)expect((await attempt('192.0.2.1',`198.51.100.${n+1}`)).status).toBe(401);
  expect((await attempt('192.0.2.1','203.0.113.1')).status).toBe(429);
  expect((await attempt('192.0.2.2','203.0.113.1')).status).toBe(401);
  const keys=sqlite.prepare('SELECT key FROM rateLimit').all().map(row=>String(row.key));
  expect(keys).toContain('192.0.2.1|/sign-in/email');
  expect(keys).toContain('192.0.2.2|/sign-in/email');
  expect(keys.join()).not.toContain('203.0.113.1');
 }finally{sqlite.close();}
});

describe("部署設定", () => {
  it("密鑰錯誤不洩漏值", () => {
    expect(() => readSettings({ ...settings, BETTER_AUTH_SECRET: "sensitive" })).toThrow("BETTER_AUTH_SECRET");
    try { readSettings({ ...settings, BETTER_AUTH_SECRET: "sensitive" }); } catch (e) { expect(String(e)).not.toContain("sensitive"); }
  });
  it("只接受完整可信 origin", () => {
    for (const APP_URL of ["https://example.test/path", "http://example.test", "https://user:pass@example.test"]) expect(() => readSettings({ ...settings, APP_URL })).toThrow();
  });
  it("APP_URL 結尾斜線自動去掉", () => {
    expect(readSettings({ ...settings, APP_URL: "https://example.test/" }).APP_URL).toBe("https://example.test");
  });
  it("設定錯誤列出欄位名稱與缺少／格式錯誤", () => {
    const env = { APP_URL: "https://example.test", ADMIN_EMAIL: "not-an-email", SETUP_SECRET: "short-sensitive" };
    expect(() => readSettings(env)).toThrow(ConfigError);
    const problems = configProblems(env);
    expect(problems).toEqual(expect.arrayContaining([
      { name: "ADMIN_EMAIL", kind: "invalid" },
      { name: "BETTER_AUTH_SECRET", kind: "missing" },
      { name: "SETUP_SECRET", kind: "invalid" },
      { name: "CODE_ENCRYPTION_KEY", kind: "missing" },
    ]));
    expect(JSON.stringify(problems)).not.toContain("sensitive");
    expect(configProblems({ ...settings, CODE_ENCRYPTION_KEY: "z".repeat(64) })).toEqual([{ name: "CODE_ENCRYPTION_KEY", kind: "invalid" }]);
    expect(configProblems({ ...settings, CODE_ENCRYPTION_KEY: "a".repeat(64) })).toEqual([]);
  });
  it("固定長度摘要比較", async () => {
    expect(await secretEqual("a", "a")).toBe(true);
    expect(await secretEqual("a", "aa")).toBe(false);
  });
});

describe("單一管理員初始化", () => {
  it("錯誤密鑰不寫入任何帳號", async () => {
    const { db, sqlite } = testDatabase();
    await expect(initialize(db, settings, { ...input, secret: "wrong" })).rejects.toThrow("INVALID_SECRET");
    expect(sqlite.prepare('SELECT count(*) AS n FROM "user"').get()?.n).toBe(0);
    sqlite.close();
  });
  it("只可初始化一次；第二次不產生額外帳號", async () => {
    const { db, sqlite } = testDatabase();
    const { userId } = await initialize(db, settings, input);
    expect(await isAdmin(db, userId)).toBe(true);
    expect(await isAdmin(db, "visitor")).toBe(false);
    await expect(initialize(db, settings, input)).rejects.toThrow("ALREADY_INITIALIZED");
    expect(sqlite.prepare('SELECT count(*) AS n FROM "user"').get()?.n).toBe(1);
    sqlite.close();
  });
  it("帳號寫入失敗時，單例標記一併回滾", async () => {
    const { db, sqlite } = testDatabase();
    sqlite.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (\'occupied\',\'x\',?,0,0,0)').run(settings.ADMIN_EMAIL);
    await expect(initialize(db, settings, input)).rejects.toThrow();
    expect(sqlite.prepare("SELECT count(*) AS n FROM installation").get()?.n).toBe(0);
    sqlite.close();
  });
  it("初始化的密碼可透過 Better Auth 登入，普通帳號無管理權", async () => {
    const { db, sqlite } = testDatabase();
    const auth = createAuth({ DB: db } as RuntimeEnv, settings);
    const blocked = await auth.handler(authRequest("sign-up/email", { name: "intruder", email: settings.ADMIN_EMAIL, password: input.password }));
    expect(blocked.status).toBe(403);
    const { userId } = await initialize(db, settings, input);
    const response = await auth.handler(authRequest("sign-in/email", { email: settings.ADMIN_EMAIL, password: input.password }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("session_token");
    const login = await response.json() as { user: { id: string } };
    expect(login.user.id).toBe(userId);
    const signUp = await auth.handler(authRequest("sign-up/email", { name: "Customer", email: "customer@example.test", password: input.password }));
    expect(signUp.status).toBe(200);
    expect(await isAdmin(db, (await signUp.json() as { user: { id: string } }).user.id)).toBe(false);
    const otp = await auth.handler(authRequest("email-otp/send-verification-otp", { email: settings.ADMIN_EMAIL, type: "sign-in" }));
    expect(otp.status).toBe(404);
    sqlite.close();
  });
});

it("啟用寄信後可用 OTP 登入，錯誤或已用過的 OTP 被拒絕", async () => {
 const { db, sqlite } = testDatabase();
 await initialize(db,settings,input);
 const sent: {to:string; text:string}[] = [];
 const auth = createAuth({ DB:db, EMAIL: { async send(message) { sent.push(message); } } } as RuntimeEnv, { ...settings, EMAIL_FROM:"sender@example.test" });
 const response = await auth.handler(authRequest("email-otp/send-verification-otp",{email:settings.ADMIN_EMAIL,type:"sign-in"}));
 expect(response.status).toBe(200);
 expect(sent).toHaveLength(1);
 expect(sent[0].to).toBe(settings.ADMIN_EMAIL);
 const otp = sent[0].text.match(/\b\d{6}\b/)![0];
 const wrong = await auth.handler(authRequest("sign-in/email-otp",{email:settings.ADMIN_EMAIL,otp:"invalid"}));
 expect(wrong.status).not.toBe(200);
 const login = await auth.handler(authRequest("sign-in/email-otp",{email:settings.ADMIN_EMAIL,otp}));
 expect(login.status).toBe(200);
 const replay = await auth.handler(authRequest("sign-in/email-otp",{email:settings.ADMIN_EMAIL,otp}));
 expect(replay.status).not.toBe(200);
 sqlite.close();
});
it("密碼註冊後的信箱驗證保留原密碼，錯誤與重放驗證碼被拒絕",async()=>{
 const {db,sqlite}=testDatabase();
 try{
  await initialize(db,settings,input);
  const sent:{text:string}[]=[];
  const auth=createAuth({DB:db,EMAIL:{async send(message){sent.push(message);}}} as RuntimeEnv,{...settings,EMAIL_FROM:"sender@example.test"});
  const email="verify-customer@example.test";
  const registered=await auth.handler(authRequest("sign-up/email",{name:"Customer",email,password:input.password}));
  expect(registered.status).toBe(200);
  expect((await auth.handler(authRequest("email-otp/send-verification-otp",{email,type:"email-verification"}))).status).toBe(200);
  const otp=sent[0].text.match(/\b\d{6}\b/)![0];
  expect((await auth.handler(authRequest("email-otp/verify-email",{email,otp:"invalid"}))).status).not.toBe(200);
  expect((await auth.handler(authRequest("email-otp/verify-email",{email,otp}))).status).toBe(200);
  expect(sqlite.prepare('SELECT emailVerified FROM "user" WHERE email=?').get(email)?.emailVerified).toBe(1);
  expect((await auth.handler(authRequest("email-otp/verify-email",{email,otp}))).status).not.toBe(200);
  expect((await auth.handler(authRequest("sign-in/email",{email,password:input.password}))).status).toBe(200);
 }finally{sqlite.close();}
});
