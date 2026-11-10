import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch} from "../src/lib/server/inventory";
import {createCampaign,setCampaignStatus,updateCampaign} from "../src/lib/server/campaigns";
import {claimCode,createCampaignLink,revokeCampaignLink,type ClaimServices} from "../src/lib/server/claims";
const services:ClaimServices={encryptionSecret:"ab".repeat(32),identitySecret:"test-identity-secret-32-characters-long",purchasedCount:async()=>0,qualify:async()=>({allowed:false}),now:()=>1000};
const actor=(userId:string)=>({userId,emailVerified:false});
async function setup(count=3,extra:Record<string,unknown>={}){
 const database=testDatabase();const {db}=database;
 const p=await createProduct(db,{name:"App",slug:"app"});
 const b=await createBatch(db,services.encryptionSecret,{productId:p.id,name:"Launch",kind:"external",source:"manual",codes:Array.from({length:count},(_,i)=>`code-${i}`)});
 const input={productId:p.id,batchId:b.id,name:"Launch",slug:"launch",conditions:{type:"always"},...extra};
 const c=await createCampaign(db,input);await setCampaignStatus(db,c.id,1,"active");
 return {...database,c,input};
}
it("最後一份庫存只有一人取得；同一冪等鍵重試不新增領取",async()=>{
 const {db,sqlite,c}=await setup(1);
 try{
  const requests=["a","b"].map(user=>({input:{campaignId:c.id,idempotencyKey:crypto.randomUUID()},user}));
  const results=await Promise.allSettled(requests.map(r=>claimCode(db,r.input,actor(r.user),services)));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  const index=results.findIndex(r=>r.status==="fulfilled");
  const replay=await claimCode(db,requests[index].input,actor(requests[index].user),services);
  expect(replay.code).toBe("code-0");
  expect(sqlite.prepare("SELECT count(*) AS n FROM claims").get()?.n).toBe(1);
  expect(sqlite.prepare("SELECT claimed_count FROM campaigns").get()?.claimed_count).toBe(1);
  expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe("assigned");
 }finally{sqlite.close();}
});
it("同時相同冪等鍵得到同一碼，總量與每人上限不超發",async()=>{
 const {db,sqlite,c}=await setup(3,{totalLimit:2});
 try{
  const input={campaignId:c.id,idempotencyKey:crypto.randomUUID()};
  const results=await Promise.all([claimCode(db,input,actor("a"),services),claimCode(db,input,actor("a"),services)]);
  expect(results[0]).toEqual(results[1]);
  await expect(claimCode(db,{...input,idempotencyKey:crypto.randomUUID()},actor("a"),services)).rejects.toThrow("CLAIM_UNAVAILABLE");
  await claimCode(db,{...input,idempotencyKey:crypto.randomUUID()},actor("b"),services);
  await expect(claimCode(db,{...input,idempotencyKey:crypto.randomUUID()},actor("c"),services)).rejects.toThrow("CLAIM_UNAVAILABLE");
  expect(sqlite.prepare("SELECT count(*) AS n FROM codes WHERE status='available'").get()?.n).toBe(1);
 }finally{sqlite.close();}
});
it("私密連結到期、撤銷與單次上限有效，不洩漏其他持有人的重試結果",async()=>{
 const {db,sqlite,c}=await setup(5,{visibility:"private"});
 try{
  const input={campaignId:c.id,idempotencyKey:crypto.randomUUID()};
  await expect(claimCode(db,{...input,recoveryOnly:true},actor("a"),services)).rejects.toThrow("CLAIM_NOT_FOUND");
  await expect(claimCode(db,input,actor("a"),services)).rejects.toThrow("CLAIM_LINK_UNAVAILABLE");
  const expired=await createCampaignLink(db,c.id,{expiresAt:1000});
  await expect(claimCode(db,{...input,linkToken:expired.token},actor("a"),services)).rejects.toThrow("CLAIM_LINK_UNAVAILABLE");
  const link=await createCampaignLink(db,c.id,{});
  const first=await claimCode(db,{...input,linkToken:link.token},actor("a"),services);
  await expect(claimCode(db,{...input,linkToken:link.token},actor("b"),services)).rejects.toThrow("CLAIM_LINK_UNAVAILABLE");
  await revokeCampaignLink(db,c.id,link.id);
  expect((await claimCode(db,{...input,recoveryOnly:true},actor("a"),services)).id).toBe(first.id);
  await expect(claimCode(db,{...input,recoveryOnly:true},actor("b"),services)).rejects.toThrow("CLAIM_NOT_FOUND");
  const revoked=await createCampaignLink(db,c.id,{maxClaims:5});await revokeCampaignLink(db,c.id,revoked.id);
  await expect(claimCode(db,{...input,linkToken:revoked.token},actor("b"),services)).rejects.toThrow("CLAIM_LINK_UNAVAILABLE");
  expect(sqlite.prepare("SELECT count(*) AS n FROM claims").get()?.n).toBe(1);
 }finally{sqlite.close();}
});
it("匿名以瀏覽器與 IP 雙重限制，原始 IP 不存進領取紀錄",async()=>{
 const {db,sqlite,c}=await setup();
 try{
  const input=()=>({campaignId:c.id,idempotencyKey:crypto.randomUUID()});
  await claimCode(db,input(),{browserId:"browser-a",ipAddress:"192.0.2.1",emailVerified:false},services);
  await expect(claimCode(db,input(),{browserId:"browser-b",ipAddress:"192.0.2.1",emailVerified:false},services)).rejects.toThrow("CLAIM_UNAVAILABLE");
  await expect(claimCode(db,input(),{browserId:"browser-a",ipAddress:"192.0.2.2",emailVerified:false},services)).rejects.toThrow("CLAIM_UNAVAILABLE");
  const row=sqlite.prepare("SELECT subject_key,anonymous_ip_key FROM claims").get();
  expect(JSON.stringify(row)).not.toContain("192.0.2.1");expect(JSON.stringify(row)).not.toContain("browser-a");
 }finally{sqlite.close();}
});
it("驗證信箱與登入要求獨立於規則；資格檢查期間設定變更不發碼",async()=>{
 const {db,sqlite,c,input}=await setup(3,{authMode:"email",conditions:{type:"external",hookId:"test"}});
 try{
  const request={campaignId:c.id,idempotencyKey:crypto.randomUUID()};
  await expect(claimCode(db,request,actor("a"),services)).rejects.toThrow("CLAIM_VERIFIED_EMAIL_REQUIRED");
  await expect(claimCode(db,request,{userId:"a",email:"a@example.com",emailVerified:true},{...services,qualify:async()=>{
   await updateCampaign(db,c.id,2,{...input,name:"Changed"});return {allowed:true};
  }})).rejects.toThrow("CLAIM_UNAVAILABLE");
  expect(sqlite.prepare("SELECT count(*) AS n FROM claims").get()?.n).toBe(0);
  expect(sqlite.prepare("SELECT claimed_count FROM campaigns").get()?.claimed_count).toBe(0);
 }finally{sqlite.close();}
});
it("外部資格完成時已跨過規則期限便拒絕，且不重送外部資格請求",async()=>{
 const {db,sqlite,c}=await setup(1,{conditions:{type:"and",children:[{type:"time",startsAt:0,endsAt:2000},{type:"external",hookId:"test"}]}});
 try{
  let now=1000;let calls=0;
  await expect(claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},actor("a"),{...services,now:()=>now,qualify:async()=>{calls++;now=2000;return {allowed:true};}})).rejects.toThrow("CONDITIONS_NOT_MET");
  expect(calls).toBe(1);expect(sqlite.prepare("SELECT count(*) AS n FROM claims").get()?.n).toBe(0);
 }finally{sqlite.close();}
});
it("我的碼只回傳該帳號領取紀錄，封存活動不影響既有持有紀錄",async()=>{
 const {listMyCodes}=await import("../src/lib/server/my-codes");
 const {db,sqlite,c}=await setup(3);
 try{
  const a=await claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},actor("a"),services);
  const b=await claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},actor("b"),services);
  await setCampaignStatus(db,c.id,2,"archived");
  const mine=await listMyCodes(db,services.encryptionSecret,"a");
  expect(mine.total).toBe(1);expect(mine.items[0].code).toBe(a.code);expect(mine.items[0].code).not.toBe(b.code);
  expect(mine.items[0]).not.toHaveProperty("ciphertext");
  expect((await listMyCodes(db,services.encryptionSecret,"stranger")).items).toEqual([]);
 }finally{sqlite.close();}
});

it('訪客綁定要求原瀏覽器及已驗證帳號，綁定後不再讓其他帳號或匿名恢復',async()=>{
 const {linkGuestClaim}=await import('../src/lib/server/claims');
 const {queueAutomaticCodeEmails}=await import('../src/lib/server/code-email');
 const {db,sqlite,c}=await setup();try{
  for(const id of ['owner','other'])sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(id,id,`${id}@example.test`,id==='owner'?0:1,0,0);
  const browserId=crypto.randomUUID(),guest={browserId,ipAddress:'192.0.2.15',emailVerified:false};
  const input={campaignId:c.id,idempotencyKey:crypto.randomUUID()};
  const claimed=await claimCode(db,input,guest,services);expect(claimed.canLink).toBe(true);
  await expect(linkGuestClaim(db,claimed.id,browserId,'owner',services.identitySecret)).rejects.toThrow('CLAIM_VERIFIED_EMAIL_REQUIRED');
  sqlite.prepare('UPDATE "user" SET emailVerified=1 WHERE id=?').run('owner');
  await expect(linkGuestClaim(db,claimed.id,crypto.randomUUID(),'owner',services.identitySecret)).rejects.toThrow('CLAIM_LINK_UNAVAILABLE');
  const before=sqlite.prepare('SELECT subject_key,anonymous_ip_key FROM claims').get();
  // 登入後先恢復原紀錄，必須由使用者明確操作才綁定。
  expect(await claimCode(db,{...input,recoveryOnly:true},{...guest,userId:'owner'},services)).toEqual(claimed);
  expect(sqlite.prepare('SELECT user_id FROM claims').get()?.user_id).toBeNull();
  expect(await linkGuestClaim(db,claimed.id,browserId,'owner',services.identitySecret)).toEqual({linked:true});
  expect(await linkGuestClaim(db,claimed.id,browserId,'owner',services.identitySecret)).toEqual({linked:true});
  await expect(linkGuestClaim(db,claimed.id,browserId,'other',services.identitySecret)).rejects.toThrow('CLAIM_LINK_UNAVAILABLE');
  const recovered=await claimCode(db,{...input,recoveryOnly:true},{userId:'owner',emailVerified:true},services);
  expect(recovered).toMatchObject({id:claimed.id,code:claimed.code,canLink:false});
  await expect(claimCode(db,{...input,recoveryOnly:true},guest,services)).rejects.toThrow('CLAIM_NOT_FOUND');
  await expect(claimCode(db,{...input,recoveryOnly:true},{...guest,userId:'other'},services)).rejects.toThrow('CLAIM_NOT_FOUND');
  expect(sqlite.prepare('SELECT subject_key,anonymous_ip_key FROM claims').get()).toEqual(before);
  expect(sqlite.prepare('SELECT claimed_count FROM campaigns WHERE id=?').get(c.id)?.claimed_count).toBe(1);
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:1});
 }finally{sqlite.close();}
});

it('綁定保留瀏覽器與 IP 限額，帳號不能另換請求鍵再領取',async()=>{
 const {linkGuestClaim}=await import('../src/lib/server/claims');
 const {db,sqlite,c}=await setup();try{
  sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('owner','Owner','owner@example.test',1,0,0);
  const guest={browserId:crypto.randomUUID(),ipAddress:'192.0.2.16',emailVerified:false};
  const input=()=>({campaignId:c.id,idempotencyKey:crypto.randomUUID()});
  const claimed=await claimCode(db,input(),guest,services);
  await linkGuestClaim(db,claimed.id,guest.browserId,'owner',services.identitySecret);
  await expect(claimCode(db,input(),{userId:'owner',emailVerified:true},services)).rejects.toThrow('CLAIM_UNAVAILABLE');
  await expect(claimCode(db,input(),{...guest,ipAddress:'192.0.2.17'},services)).rejects.toThrow('CLAIM_UNAVAILABLE');
  await expect(claimCode(db,input(),{...guest,browserId:crypto.randomUUID()},services)).rejects.toThrow('CLAIM_UNAVAILABLE');
  expect(sqlite.prepare('SELECT count(*) AS n FROM claims').get()?.n).toBe(1);
 }finally{sqlite.close();}
});
