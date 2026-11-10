import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch} from "../src/lib/server/inventory";
import {createCampaign,setCampaignStatus} from "../src/lib/server/campaigns";
import {claimCode} from "../src/lib/server/claims";
import {readOverview} from "../src/lib/server/dashboard-overview";

const secret="ab".repeat(32);
it("空資料庫回傳零值與 14 天的空白序列",async()=>{
 const {db,sqlite}=testDatabase();try{
  const data=await readOverview(db,Date.UTC(2026,10,8,12));
  expect(data.products).toEqual({active:0,archived:0});
  expect(data.daily).toHaveLength(14);
  expect(data.daily.at(-1)?.day).toBe(Date.UTC(2026,10,8));
  expect(data.recent).toEqual([]);
  expect(data.setup).toEqual({product:false,codes:false,campaign:false});
 }finally{sqlite.close();}
});
it("統計商品、碼與領取，領取依 UTC 日期分組並出現在最近動態",async()=>{
 const {db,sqlite}=testDatabase();try{
  const now=Date.UTC(2026,10,8,12);
  const p=await createProduct(db,{name:"App",slug:"app"});
  const b=await createBatch(db,secret,{productId:p.id,name:"Launch",kind:"external",source:"manual",codes:["a","b","c"]});
  const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:"Launch",slug:"launch",conditions:{type:"always"}});
  await setCampaignStatus(db,c.id,1,"active");
  await claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{userId:"u1",emailVerified:true,email:"u1@example.test"},{encryptionSecret:secret,identitySecret:"test-identity-secret-32-characters-long",purchasedCount:async()=>0,qualify:async()=>({allowed:false}),now:()=>now-1000});
  sqlite.prepare("UPDATE claims SET created_at=?").run(now-1000);
  const data=await readOverview(db,now);
  expect(data.products.active).toBe(1);
  expect(data.codes).toEqual({total:3,available:2});
  expect(data.claims).toEqual({last30:1,today:1});
  expect(data.daily.at(-1)).toMatchObject({claims:1,orders:0});
  expect(data.recent[0]).toMatchObject({kind:"claim",productName:"App",label:"Launch"});
  expect(data.setup).toEqual({product:true,codes:true,campaign:true});
 }finally{sqlite.close();}
});
