import {describe,expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch,changeCodeStatus} from "../src/lib/server/inventory";
import {createCampaign,setCampaignStatus} from "../src/lib/server/campaigns";
import {claimCode} from "../src/lib/server/claims";
import {fingerprint} from "../src/lib/domain/codes";
import {takeCode,updateHandout,undoHandout,listHandouts,handoutSources} from "../src/lib/server/handouts";

const secret="ab".repeat(32);
async function setup(codes=["APPSTORE-A","APPSTORE-B","APPSTORE-C"]){
 const database=testDatabase();const {db,sqlite}=database;
 sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,0,0)').run("admin","Admin","admin@example.test",1);
 sqlite.prepare("INSERT INTO installation(id,admin_user_id,created_at) VALUES(1,'admin',0)").run();
 const p=await createProduct(db,{name:"App",slug:"app"});
 const b=await createBatch(db,secret,{productId:p.id,name:"App Store promo",kind:"external",source:"manual",codes});
 return {...database,p,b};
}
const take=(db:D1Database,productId:string,extra:Record<string,unknown>={})=>takeCode(db,secret,"admin",{productId,idempotencyKey:crypto.randomUUID(),...extra});

describe("手動發放",()=>{
 it("取碼即佔用：每次拿到不同的碼，碼變成已分配，重送同冪等鍵回同一筆",async()=>{
  const {db,sqlite,p}=await setup();try{
   const key=crypto.randomUUID();
   const first=await takeCode(db,secret,"admin",{productId:p.id,idempotencyKey:key});
   expect(first.code).toMatch(/^APPSTORE-/);expect(first.recipient).toBeNull();
   expect(await takeCode(db,secret,"admin",{productId:p.id,idempotencyKey:key})).toEqual(first);
   const [second,third]=await Promise.all([take(db,p.id),take(db,p.id)]);
   expect(new Set([first.code,second.code,third.code]).size).toBe(3);
   expect(sqlite.prepare("SELECT count(*) n FROM codes WHERE status='assigned'").get()?.n).toBe(3);
   await expect(take(db,p.id)).rejects.toThrow("HANDOUT_UNAVAILABLE");
  }finally{sqlite.close();}
 });
 it("優先發放最早到期的碼，跳過已過期的碼",async()=>{
  const {db,sqlite,p}=await setup(["LATE","SOON","EXPIRED","NEVER"]);try{
   const now=Date.now();
   const set=async(code:string,at:number)=>sqlite.prepare("UPDATE codes SET expires_at=? WHERE fingerprint=?").run(at,await fingerprint(code));
   await set("LATE",now+10*86400000);await set("SOON",now+86400000);await set("EXPIRED",now-1000);
   expect((await take(db,p.id)).code).toBe("SOON");
   expect((await take(db,p.id)).code).toBe("LATE");
   expect((await take(db,p.id)).code).toBe("NEVER");
   await expect(take(db,p.id)).rejects.toThrow("HANDOUT_UNAVAILABLE");
  }finally{sqlite.close();}
 });
 it("收件人可留空，之後補填並可搜尋；撤回放回庫存，撤回後不能再改",async()=>{
  const {db,sqlite,p}=await setup();try{
   const handout=await take(db,p.id,{recipient:"  "});
   expect(handout.recipient).toBeNull();
   expect((await listHandouts(db,secret,{missingRecipient:true})).items.map(i=>i.id)).toEqual([handout.id]);
   // 查詢字串傳 "false" 時不能被當成 true；其他值一律拒絕。
   const named=await take(db,p.id,{recipient:"Leo"});
   expect((await listHandouts(db,secret,{missingRecipient:'true'})).items.map(i=>i.id)).toEqual([handout.id]);
   expect((await listHandouts(db,secret,{missingRecipient:'false'})).items.map(i=>i.id).sort()).toEqual([handout.id,named.id].sort());
   await expect(listHandouts(db,secret,{missingRecipient:'yes'})).rejects.toThrow();
   await undoHandout(db,secret,named.id);
   const updated=await updateHandout(db,secret,handout.id,{recipient:"Mia (@mia_dev)",channel:"WeChat",note:"Beta tester"});
   expect(updated).toMatchObject({recipient:"Mia (@mia_dev)",channel:"WeChat",note:"Beta tester"});
   expect((await listHandouts(db,secret,{query:"mia"})).items).toHaveLength(1);
   expect((await listHandouts(db,secret,{query:"wechat"})).items).toHaveLength(1);
   expect((await listHandouts(db,secret,{query:"nobody"})).items).toHaveLength(0);
   const undone=await undoHandout(db,secret,handout.id);
   expect(undone?.undoneAt).not.toBeNull();
   expect(sqlite.prepare("SELECT status FROM codes WHERE id=?").get(handout.codeId)?.status).toBe("available");
   await expect(updateHandout(db,secret,handout.id,{recipient:"x"})).rejects.toThrow("HANDOUT_NOT_FOUND");
   expect((await listHandouts(db,secret,{})).items).toHaveLength(0);
   // 放回的碼可以再發給別人。
   const again=await take(db,p.id);
   expect(again.code).toBeTruthy();
  }finally{sqlite.close();}
 });
 it("撤回時碼已被撤銷則保持撤銷",async()=>{
  const {db,sqlite,p}=await setup(["ONE"]);try{
   const handout=await take(db,p.id);
   await changeCodeStatus(db,{productId:p.id,ids:[handout.codeId],action:"revoke"});
   await undoHandout(db,secret,handout.id);
   expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe("revoked");
  }finally{sqlite.close();}
 });
 it("已被領取的碼不會被發放；發放出去的碼不會再被活動領走",async()=>{
  const {db,sqlite,p,b}=await setup(["A","B"]);try{
   const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:"Free",slug:"free",conditions:{type:"always"}});
   await setCampaignStatus(db,c.id,1,"active");
   const services={encryptionSecret:secret,identitySecret:"test-identity-secret-32-characters-long",purchasedCount:async()=>0,qualify:async()=>({allowed:false})};
   const claimed=await claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{userId:"u1",email:"u1@example.test",emailVerified:true},services);
   const handout=await take(db,p.id);
   expect(handout.code).not.toBe(claimed.code);
   await expect(claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{userId:"u2",email:"u2@example.test",emailVerified:true},services)).rejects.toThrow("CLAIM_UNAVAILABLE");
  }finally{sqlite.close();}
 });
 it("只有管理員能發放；不同商品不能共用冪等鍵；可依批次挑碼",async()=>{
  const {db,sqlite,p}=await setup();try{
   sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,0,0)').run("other","Other","o@example.test",1);
   await expect(takeCode(db,secret,"other",{productId:p.id,idempotencyKey:crypto.randomUUID()})).rejects.toThrow("HANDOUT_FORBIDDEN");
   const p2=await createProduct(db,{name:"Second",slug:"second"});
   const b2=await createBatch(db,secret,{productId:p2.id,name:"Other batch",kind:"external",source:"manual",codes:["SECOND-1"]});
   const key=crypto.randomUUID();
   await takeCode(db,secret,"admin",{productId:p.id,idempotencyKey:key});
   await expect(takeCode(db,secret,"admin",{productId:p2.id,idempotencyKey:key})).rejects.toThrow("HANDOUT_IDEMPOTENCY_CONFLICT");
   expect((await take(db,p2.id,{batchId:b2.id})).code).toBe("SECOND-1");
   const sources=await handoutSources(db);
   expect(sources.find(s=>s.id===p.id)?.batches[0].available).toBe(2);
   expect(sources.find(s=>s.id===p2.id)?.batches[0].available).toBe(0);
  }finally{sqlite.close();}
 });
});
