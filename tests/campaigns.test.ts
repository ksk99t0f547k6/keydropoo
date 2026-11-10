import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch,archiveProduct} from "../src/lib/server/inventory";
import {createCampaign,getCampaign,updateCampaign,setCampaignStatus,listCampaigns} from "../src/lib/server/campaigns";
it("活動來源必須同一商品；更新版本避免覆蓋其他操作，封存商品不可啟用",async()=>{
 const {db,sqlite}=testDatabase();
 try{
  const product=await createProduct(db,{name:"App",slug:"app"});
  const other=await createProduct(db,{name:"Other",slug:"other"});
  const batch=await createBatch(db,"ab".repeat(32),{productId:product.id,name:"Batch",kind:"redemption",source:"manual",codes:["code"]});
  const input={productId:product.id,batchId:batch.id,name:"Launch",slug:"launch",conditions:{type:"time",startsAt:0}};
  await expect(createCampaign(db,{...input,productId:other.id})).rejects.toThrow("CAMPAIGN_SOURCE_UNAVAILABLE");
  const created=await createCampaign(db,input);
  expect((await getCampaign(db,created.id))?.status).toBe("draft");
  await updateCampaign(db,created.id,1,{...input,name:"Updated",totalLimit:10});
  await expect(updateCampaign(db,created.id,1,{...input,name:"Stale"})).rejects.toThrow("CAMPAIGN_CONFLICT");
  expect((await getCampaign(db,created.id))?.name).toBe("Updated");
  await setCampaignStatus(db,created.id,2,"active");
  await archiveProduct(db,product.id,true);
  await setCampaignStatus(db,created.id,3,"paused");
  await expect(setCampaignStatus(db,created.id,4,"active")).rejects.toThrow("CAMPAIGN_CONFLICT");
  expect((await listCampaigns(db,{productId:other.id})).total).toBe(0);
  expect((await listCampaigns(db,{productId:product.id})).total).toBe(1);
  sqlite.prepare("UPDATE campaigns SET claimed_count=5 WHERE id=?").run(created.id);
  await expect(updateCampaign(db,created.id,4,{...input,totalLimit:4})).rejects.toThrow("CAMPAIGN_CONFLICT");
 }finally{sqlite.close();}
});
it("活動口令僅存雜湊且依活動與類型隔離，撤銷和輪替立即生效",async()=>{
 const {saveCampaignCredential,verifyCampaignCredential,revokeCampaignCredential,listCampaignCredentials}=await import("../src/lib/server/campaign-credentials");
 const {db,sqlite}=testDatabase();
 try{
  const p=await createProduct(db,{name:"App",slug:"app"});
  const b=await createBatch(db,"ab".repeat(32),{productId:p.id,name:"Codes",kind:"external",source:"manual",codes:["one"]});
  const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:"Launch",slug:"launch",conditions:{type:"authenticated"}});
  const input={id:"launch",kind:"passphrase",secret:"first-secret"};
  await saveCampaignCredential(db,c.id,input);
  expect(await verifyCampaignCredential(db,c.id,"launch",input.secret,"passphrase")).toBe(true);
  expect(await verifyCampaignCredential(db,c.id,"launch",input.secret,"invitation")).toBe(false);
  expect(await verifyCampaignCredential(db,crypto.randomUUID(),"launch",input.secret,"passphrase")).toBe(false);
  expect(JSON.stringify(await listCampaignCredentials(db,c.id))).not.toContain(input.secret);
  expect(sqlite.prepare("SELECT secret_hash FROM campaign_credentials").get()?.secret_hash).not.toBe(input.secret);
  await revokeCampaignCredential(db,c.id,{id:"launch",kind:"passphrase"});
  expect(await verifyCampaignCredential(db,c.id,"launch",input.secret,"passphrase")).toBe(false);
  await saveCampaignCredential(db,c.id,{...input,secret:"second-secret"});
  expect(await verifyCampaignCredential(db,c.id,"launch",input.secret,"passphrase")).toBe(false);
  expect(await verifyCampaignCredential(db,c.id,"launch","second-secret","passphrase")).toBe(true);
 }finally{sqlite.close();}
});
