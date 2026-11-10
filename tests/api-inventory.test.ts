import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch} from "../src/lib/server/inventory";
import {createCampaign,setCampaignStatus} from "../src/lib/server/campaigns";
import {createApiToken} from "../src/lib/server/api-tokens";
import {authenticatedApiOperation} from "../src/lib/server/api-operations";
import {handleMcpRequest} from "../src/lib/server/mcp";
const encryptionSecret="ab".repeat(32),identitySecret="test-identity-secret-at-least-32-characters";
async function setup(){
 const database=testDatabase(),{db,sqlite}=database;
 const a=await createProduct(db,{name:"A",slug:"a"}),b=await createProduct(db,{name:"B",slug:"b"});
 const batch=await createBatch(db,encryptionSecret,{productId:a.id,name:"Test",kind:"external",source:"manual",codes:["ONE","TWO"]});
 const campaign=await createCampaign(db,{productId:a.id,batchId:batch.id,name:"Launch",slug:"launch",authMode:"email",conditions:{type:"verified_email"}});await setCampaignStatus(db,campaign.id,1,"active");
 sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,0,0)').run("customer","Customer","customer@example.test",1);
 const token=await createApiToken(db,{name:"Backend",scopes:["products:read","codes:read","codes:write","codes:issue","campaigns:read","campaigns:write"],productIds:[a.id],mcpWriteEnabled:true});
 const services={claims:{encryptionSecret,identitySecret,purchasedCount:async()=>0,qualify:async()=>({allowed:false})}};
 return {...database,a,b,batch,campaign,token,services,call:(input:unknown)=>authenticatedApiOperation(db,`Bearer ${token.token}`,input,services)};
}
it("庫存管理只顯示授權商品，不外洩密文或原始碼，異商品 ID 不可越權",async()=>{
 const {sqlite,a,b,call}=await setup();try{
  expect(await call({action:"products.read",productId:a.id})).toMatchObject({product:{name:"A"}});
  const list=await call({action:"codes.read",productId:a.id});
  expect(list).toMatchObject({total:2});expect(JSON.stringify(list)).not.toContain("ciphertext");expect(JSON.stringify(list)).not.toContain('"ONE"');
  const id=sqlite.prepare("SELECT id FROM codes LIMIT 1").get()!.id;
  expect(await call({action:"codes.update",productId:a.id,ids:[id],change:"revoke"})).toEqual({changed:1});
  expect(await call({action:"codes.update",productId:a.id,ids:[id],change:"revoke"})).toEqual({changed:0});
  await expect(call({action:"codes.update",productId:b.id,ids:[id],change:"restore"})).rejects.toThrow("API_SCOPE_DENIED");
  await expect(call({action:"products.read",productId:b.id})).rejects.toThrow("API_SCOPE_DENIED");
 }finally{sqlite.close();}
});
it("API 發碼保留活動資格及每人上限，重試回同一碼，不允許偽造信箱驗證",async()=>{
 const {sqlite,a,campaign,call}=await setup();try{
  const input={action:"codes.issue",productId:a.id,userId:"customer",campaignId:campaign.id,idempotencyKey:crypto.randomUUID()};
  sqlite.prepare('UPDATE "user" SET emailVerified=0').run();
  await expect(call(input)).rejects.toThrow("CLAIM_VERIFIED_EMAIL_REQUIRED");
  await expect(call({...input,emailVerified:true})).rejects.toThrow();
  sqlite.prepare('UPDATE "user" SET emailVerified=1').run();
  const first=await call(input);expect(await call(input)).toEqual(first);
  await expect(call({...input,idempotencyKey:crypto.randomUUID()})).rejects.toThrow("CLAIM_UNAVAILABLE");
  expect(sqlite.prepare("SELECT count(*) AS n FROM claims").get()?.n).toBe(1);
 }finally{sqlite.close();}
});
it("活動狀態操作檢查來源商品及版本，發碼不能引用其他商品活動",async()=>{
 const {db,sqlite,a,b,campaign,call}=await setup();try{
  const batch=await createBatch(db,encryptionSecret,{productId:b.id,name:"Other",kind:"external",source:"manual",codes:["OTHER"]});
  const other=await createCampaign(db,{productId:b.id,batchId:batch.id,name:"Other",slug:"other",conditions:{type:"always"}});
  await expect(call({action:"campaigns.status",productId:a.id,campaignId:other.id,expectedVersion:1,status:"active"})).rejects.toThrow("CAMPAIGN_NOT_FOUND");
  await expect(call({action:"codes.issue",productId:a.id,userId:"customer",campaignId:other.id,idempotencyKey:crypto.randomUUID()})).rejects.toThrow("CAMPAIGN_NOT_FOUND");
  await call({action:"campaigns.status",productId:a.id,campaignId:campaign.id,expectedVersion:2,status:"paused"});
  await expect(call({action:"campaigns.status",productId:a.id,campaignId:campaign.id,expectedVersion:2,status:"active"})).rejects.toThrow("CAMPAIGN_CONFLICT");
 }finally{sqlite.close();}
});
it("MCP 發碼使用相同授權與冪等服務，讀庫存不代表可以取碼",async()=>{
 const {db,sqlite,a,campaign,services,token}=await setup();try{
  const context={db,appUrl:"https://example.test",identitySecret,services};
  const args={productId:a.id,userId:"customer",campaignId:campaign.id,idempotencyKey:crypto.randomUUID()};
  const request=(secret:string)=>new Request("https://example.test/mcp",{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"issue_code",arguments:args}})});
  const first=await (await handleMcpRequest(request(token.token),context)).json();
  expect(first).toMatchObject({result:{structuredContent:{status:"assigned"}}});
  expect(await (await handleMcpRequest(request(token.token),context)).json()).toEqual(first);
  const reader=await createApiToken(db,{name:"Reader",scopes:["codes:read"],productIds:[a.id],mcpWriteEnabled:true});
  expect(await (await handleMcpRequest(request(reader.token),context)).json()).toMatchObject({error:{code:-32602,message:"Tool issue_code not found"}});
  expect(sqlite.prepare("SELECT count(*) AS n FROM claims").get()?.n).toBe(1);
 }finally{sqlite.close();}
});
