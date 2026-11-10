import {expect,it} from "vitest";
import {browserIdentity,claimRateLimit} from "../src/lib/server/claim-identity";
import {testDatabase} from "./d1";
const secret="test-cookie-secret-at-least-32-characters";
it("匿名 cookie 簽章、期限和安全屬性有效，偽造值會換新識別",async()=>{
 const now=1700000000000;const first=await browserIdentity(null,secret,true,now);
 expect(first.setCookie).toContain("__Host-keydrop-browser=");expect(first.setCookie).toContain("HttpOnly");expect(first.setCookie).toContain("; Secure");
 const cookie=first.setCookie!.split(";")[0];
 expect(await browserIdentity(cookie,secret,true,now+1)).toEqual({id:first.id,setCookie:null});
 const tampered=cookie.replace(first.id,crypto.randomUUID());
 expect((await browserIdentity(tampered,secret,true,now+1)).id).not.toBe(first.id);
 expect((await browserIdentity(cookie,secret,true,now+366*86400000)).id).not.toBe(first.id);
 expect((await browserIdentity(cookie,"different-secret-at-least-32-characters",true,now+1)).id).not.toBe(first.id);
 expect((await browserIdentity(null,secret,false,now)).setCookie).not.toContain("; Secure");
});
it("領取嘗試每 IP 每分鐘最多 30 次，下一時間窗恢復且不存明文 IP",async()=>{
 const {db,sqlite}=testDatabase();
 try{
  for(let i=0;i<30;i++)expect(await claimRateLimit(db,secret,"192.0.2.1",1000)).toBe(true);
  expect(await claimRateLimit(db,secret,"192.0.2.1",1000)).toBe(false);
  expect(await claimRateLimit(db,secret,"192.0.2.2",1000)).toBe(true);
  expect(JSON.stringify(sqlite.prepare("SELECT * FROM claim_rate_limits").all())).not.toContain("192.0.2");
  expect(await claimRateLimit(db,secret,"192.0.2.1",61000)).toBe(true);
  expect(sqlite.prepare("SELECT count(*) AS n FROM claim_rate_limits").get()?.n).toBe(1);
 }finally{sqlite.close();}
});
