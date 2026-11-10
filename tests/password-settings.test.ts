import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {testDatabase} from './d1';
import {initialize} from '../src/lib/server/bootstrap';
import {createAuth} from '../src/lib/server/auth';
import {readSettings} from '../src/lib/server/config';
import type {RuntimeEnv} from '../src/lib/server/env';
import type {Settings} from '../src/lib/server/config';
const fixture=vi.hoisted(()=>({env:{} as RuntimeEnv,settings:{} as Settings}));
vi.mock('../src/lib/server/env',()=>({runtime:async()=>fixture}));
import {POST} from '../src/app/api/account/password/route';

const origin='http://localhost:3000',email='owner@example.test';
const oldPassword='fixture-original-password',newPassword='fixture-replacement-password';
let database:ReturnType<typeof testDatabase>,sent:{to:string;subject:string;text:string}[],auth:ReturnType<typeof createAuth>,requestNumber=0;
beforeEach(async()=>{
 database=testDatabase();sent=[];requestNumber=0;
 fixture.settings=readSettings({APP_URL:origin,ADMIN_EMAIL:email,BETTER_AUTH_SECRET:'fixture-auth-secret-for-password-tests-32',SETUP_SECRET:'fixture-setup-secret-for-password-tests-32',EMAIL_FROM:'sender@example.test'});
 fixture.env={DB:database.db,EMAIL:{async send(message){sent.push(message);}}} as RuntimeEnv;
 await initialize(database.db,fixture.settings,{name:'Owner',password:oldPassword,secret:fixture.settings.SETUP_SECRET});
 auth=createAuth(fixture.env,fixture.settings);
});
afterEach(()=>database.sqlite.close());
function request(path:string,body:unknown,cookie='',requestOrigin=origin){return new Request(origin+path,{method:'POST',headers:{origin:requestOrigin,'Content-Type':'application/json',cookie,'cf-connecting-ip':`192.0.2.${++requestNumber}`},body:JSON.stringify(body)});}
const call=(path:string,body:unknown,cookie='')=>auth.handler(request('/api/auth/'+path,body,cookie));
const cookies=(response:Response)=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
const setup=(body:unknown,cookie='',requestOrigin=origin)=>POST(request('/api/account/password',body,cookie,requestOrigin));
async function session(cookie:string){return auth.api.getSession({headers:new Headers({cookie}),query:{disableCookieCache:true}});}
async function otpLogin(){
 expect((await call('email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 const otp=sent.at(-1)!.text.match(/\b\d{6}\b/)![0];
 const response=await call('sign-in/email-otp',{email,otp});expect(response.status).toBe(200);return cookies(response);
}

it('首次 OTP 清理未驗證憑證後可設定本人新密碼，舊 session 失效且不能覆寫既有密碼',async()=>{
 const original=await call('sign-in/email',{email,password:oldPassword});expect(original.status).toBe(200);
 const originalCookie=cookies(original),verifiedCookie=await otpLogin();
 expect(await session(originalCookie)).toBeNull();
 expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM account WHERE providerId='credential'").get()?.n).toBe(0);
 const result=await setup({newPassword},verifiedCookie);expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toBe('no-store');
 const denied=await setup({newPassword:'fixture-unwanted-password'},verifiedCookie);expect(denied.status).toBe(409);expect(await denied.json()).toEqual({error:'PASSWORD_ALREADY_SET'});
 expect((await call('sign-in/email',{email,password:oldPassword})).status).toBe(401);
 expect((await call('sign-in/email',{email,password:newPassword})).status).toBe(200);
 expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM account WHERE providerId='credential'").get()?.n).toBe(1);
});

it('拒絕匿名、未驗證帳號、跨來源、過大本文與指定其他帳號',async()=>{
 expect((await setup({newPassword})).status).toBe(401);
 const unverified=cookies(await call('sign-in/email',{email,password:oldPassword}));
 const notVerified=await setup({newPassword},unverified);expect(notVerified.status).toBe(403);expect(await notVerified.json()).toEqual({error:'EMAIL_VERIFICATION_REQUIRED'});
 const cookie=await otpLogin();
 expect((await setup({newPassword},cookie,'https://other.test')).status).toBe(403);
 expect((await setup({newPassword,userId:'someone-else'},cookie)).status).toBe(400);
 expect((await setup({newPassword:'short'},cookie)).status).toBe(400);
 expect((await setup({newPassword:'x'.repeat(129)},cookie)).status).toBe(400);
 const large=await setup({newPassword:'x'.repeat(3000)},cookie);expect(large.status).toBe(413);expect(large.headers.get('Cache-Control')).toBe('no-store');
 expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM account').get()?.n).toBe(0);
});

it('過時與已撤銷的工作階段不能設定密碼，重新 OTP 登入後可設定',async()=>{
 const cookie=await otpLogin();
 database.sqlite.prepare('UPDATE session SET createdAt=?').run(new Date(Date.now()-16*60*1000).toISOString());
 const stale=await setup({newPassword},cookie);expect(stale.status).toBe(403);expect(await stale.json()).toEqual({error:'SESSION_NOT_FRESH'});
 database.sqlite.prepare('DELETE FROM session').run();expect((await setup({newPassword},cookie)).status).toBe(401);
 const fresh=await otpLogin();expect((await setup({newPassword},fresh)).status).toBe(200);
});

it('同時設定不會產生兩份憑證或覆寫第一次成功的密碼',async()=>{
 const cookie=await otpLogin(),other='fixture-concurrent-password';
 const results=await Promise.all([setup({newPassword},cookie),setup({newPassword:other},cookie)]);
 expect(results.filter(result=>result.status===200)).toHaveLength(1);
 expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM account').get()?.n).toBe(1);
 const accepted=results[0].status===200?newPassword:other;
 expect((await call('sign-in/email',{email,password:accepted})).status).toBe(200);
});

it('設定端點依本人帳號限流，不能靠新 IP 或額外請求持續雜湊密碼',async()=>{
 const cookie=await otpLogin();expect((await setup({newPassword},cookie)).status).toBe(200);
 expect((await setup({newPassword},cookie)).status).toBe(409);
 expect((await setup({newPassword},cookie)).status).toBe(409);
 const blocked=await setup({newPassword},cookie);expect(blocked.status).toBe(429);expect(await blocked.json()).toEqual({error:'RATE_LIMITED'});
});

it('更改既有密碼需要原密碼，成功後撤銷其他工作階段',async()=>{
 const first=cookies(await call('sign-in/email',{email,password:oldPassword}));
 const second=cookies(await call('sign-in/email',{email,password:oldPassword}));
 expect((await call('change-password',{currentPassword:'incorrect-password',newPassword,revokeOtherSessions:true},first)).status).not.toBe(200);
 expect(await session(second)).not.toBeNull();
 const changed=await call('change-password',{currentPassword:oldPassword,newPassword,revokeOtherSessions:true},first);expect(changed.status).toBe(200);
 expect(await session(second)).toBeNull();expect(await session(cookies(changed))).not.toBeNull();
 expect((await call('sign-in/email',{email,password:oldPassword})).status).toBe(401);
 expect((await call('sign-in/email',{email,password:newPassword})).status).toBe(200);
});

it('Email 重設不暴露帳號是否存在，驗證用途、單次使用並撤銷所有舊 session',async()=>{
 const first=cookies(await call('sign-in/email',{email,password:oldPassword}));
 const second=cookies(await call('sign-in/email',{email,password:oldPassword}));
 const absent=await call('email-otp/request-password-reset',{email:'missing@example.test'});expect(absent.status).toBe(200);expect(sent).toHaveLength(0);
 const present=await call('email-otp/request-password-reset',{email});expect(present.status).toBe(200);expect(await present.json()).toEqual(await absent.json());
 expect(sent).toHaveLength(1);expect(sent[0].subject).toBe('Reset your Keydrop password');
 const otp=sent[0].text.match(/\b\d{6}\b/)![0];
 expect((await call('sign-in/email-otp',{email,otp})).status).not.toBe(200);
 expect((await call('email-otp/reset-password',{email,otp:'invalid',password:newPassword})).status).not.toBe(200);
 expect(await session(first)).not.toBeNull();
 expect((await call('email-otp/reset-password',{email,otp,password:'short'})).status).not.toBe(200);
 const reset=await call('email-otp/reset-password',{email,otp,password:newPassword});expect(reset.status).toBe(200);
 expect(await session(first)).toBeNull();expect(await session(second)).toBeNull();
 expect((await call('email-otp/reset-password',{email,otp,password:'fixture-replayed-password'})).status).not.toBe(200);
 expect((await call('sign-in/email',{email,password:oldPassword})).status).toBe(401);
 expect((await call('sign-in/email',{email,password:newPassword})).status).toBe(200);
});

it('未配置寄信時重設端點不可用，原有密碼變更仍可使用',async()=>{
 const noMail=createAuth({DB:database.db} as RuntimeEnv,fixture.settings);
 expect((await noMail.handler(request('/api/auth/email-otp/request-password-reset',{email}))).status).toBe(404);
 const logged=await noMail.handler(request('/api/auth/sign-in/email',{email,password:oldPassword}));
 expect((await noMail.handler(request('/api/auth/change-password',{currentPassword:oldPassword,newPassword,revokeOtherSessions:true},cookies(logged)))).status).toBe(200);
 expect(sent).toHaveLength(0);
});

it('過期重設驗證碼不變更密碼或撤銷原工作階段',async()=>{
 const cookie=cookies(await call('sign-in/email',{email,password:oldPassword}));
 expect((await call('email-otp/request-password-reset',{email})).status).toBe(200);
 const otp=sent[0].text.match(/\b\d{6}\b/)![0];
 database.sqlite.prepare('UPDATE verification SET expiresAt=?').run(new Date(Date.now()-1000).toISOString());
 expect((await call('email-otp/reset-password',{email,otp,password:newPassword})).status).not.toBe(200);
 expect(await session(cookie)).not.toBeNull();
 expect((await call('sign-in/email',{email,password:oldPassword})).status).toBe(200);
 expect((await call('sign-in/email',{email,password:newPassword})).status).toBe(401);
});
