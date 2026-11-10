import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch} from "../src/lib/server/inventory";
import {createApiToken} from "../src/lib/server/api-tokens";
import {authenticatedApiOperation} from "../src/lib/server/api-operations";
const secret="ab".repeat(32);
it("商品管理必須有寫入權限，建立商品只接受全部商品授權",async()=>{
 const {db,sqlite}=testDatabase();try{
  const a=await createProduct(db,{name:"A",slug:"a"});
  const limited=await createApiToken(db,{name:"Limited",scopes:["products:write"],productIds:[a.id]});
  const all=await createApiToken(db,{name:"All",scopes:["products:write"],productIds:null});
  const read=await createApiToken(db,{name:"Read",scopes:["products:read"],productIds:null});
  const action={action:"products.create",product:{name:"B",slug:"b"}};
  await expect(authenticatedApiOperation(db,`Bearer ${limited.token}`,action)).rejects.toThrow("API_SCOPE_DENIED");
  await expect(authenticatedApiOperation(db,`Bearer ${read.token}`,action)).rejects.toThrow("API_SCOPE_DENIED");
  const created=await authenticatedApiOperation(db,`Bearer ${all.token}`,action);
  expect(created).toMatchObject({name:"B",slug:"b"});
  await expect(authenticatedApiOperation(db,`Bearer ${all.token}`,action)).rejects.toThrow();
  await authenticatedApiOperation(db,`Bearer ${limited.token}`,{action:"products.update",productId:a.id,product:{name:"A2",slug:"a",priceMinor:200}});
  expect(sqlite.prepare("SELECT name,price_minor FROM products WHERE id=?").get(a.id)).toMatchObject({name:"A2",price_minor:200});
  await expect(authenticatedApiOperation(db,`Bearer ${limited.token}`,{action:"products.archive",productId:crypto.randomUUID(),archived:true})).rejects.toThrow("API_SCOPE_DENIED");
  await authenticatedApiOperation(db,`Bearer ${limited.token}`,{action:"products.archive",productId:a.id,archived:true});
  expect(sqlite.prepare("SELECT archived_at FROM products WHERE id=?").get(a.id)?.archived_at).not.toBeNull();
 }finally{sqlite.close();}
});
it("補貨 API 要求商品範圍及寫入權限，重試不重複且不回傳原始碼",async()=>{
 const {db,sqlite}=testDatabase();try{
  const a=await createProduct(db,{name:"A",slug:"a"}),b=await createProduct(db,{name:"B",slug:"b"});
  const batch=await createBatch(db,secret,{productId:a.id,name:"Batch",kind:"external",source:"import",codes:["original"]});
  const writer=await createApiToken(db,{name:"Write",scopes:["codes:write"],productIds:[a.id]});
  const reader=await createApiToken(db,{name:"Read",scopes:["codes:read"],productIds:[a.id]});
  const raw={action:"batches.restock",productId:a.id,batchId:batch.id,codes:["new-secret-code"],idempotencyKey:crypto.randomUUID()};
  const services={claims:{encryptionSecret:secret,identitySecret:"fixture-only-identity",purchasedCount:async()=>0,qualify:async()=>({allowed:false})}};
  await expect(authenticatedApiOperation(db,`Bearer ${reader.token}`,raw,services)).rejects.toThrow("API_SCOPE_DENIED");
  await expect(authenticatedApiOperation(db,`Bearer ${writer.token}`,{...raw,productId:b.id},services)).rejects.toThrow("API_SCOPE_DENIED");
  const receipt=await authenticatedApiOperation(db,`Bearer ${writer.token}`,raw,services);
  expect(await authenticatedApiOperation(db,`Bearer ${writer.token}`,raw,services)).toEqual(receipt);
  expect(JSON.stringify(receipt)).not.toContain("new-secret-code");
  expect(sqlite.prepare("SELECT count(*) n FROM codes").get()?.n).toBe(2);
 }finally{sqlite.close();}
});

it("活動管理隔離商品及購買條件，固定批次且拒絕過期版本",async()=>{
 const {db,sqlite}=testDatabase();try{
  const a=await createProduct(db,{name:"A",slug:"a"}),b=await createProduct(db,{name:"B",slug:"b"});
  const batch=await createBatch(db,secret,{productId:a.id,name:"Batch",kind:"external",source:"import",codes:["a"]});
  const other=await createBatch(db,secret,{productId:b.id,name:"Other",kind:"external",source:"import",codes:["b"]});
  const token=await createApiToken(db,{name:"Manage",scopes:["campaigns:read","campaigns:write"],productIds:[a.id]});
  const header=`Bearer ${token.token}`;
  const campaign={productId:a.id,batchId:batch.id,name:"Launch",slug:"launch",conditions:{type:"and",children:[{type:"authenticated"},{type:"verified_email"}]}};
  await expect(authenticatedApiOperation(db,header,{action:"campaigns.create",campaign:{...campaign,batchId:other.id}})).rejects.toThrow("CAMPAIGN_SOURCE_UNAVAILABLE");
  await expect(authenticatedApiOperation(db,header,{action:"campaigns.create",campaign:{...campaign,conditions:{type:"purchase",productId:b.id}}})).rejects.toThrow("API_SCOPE_DENIED");
  const result=await authenticatedApiOperation(db,header,{action:"campaigns.create",campaign}) as {id:string;version:number};
  expect(await authenticatedApiOperation(db,header,{action:"campaigns.get",productId:a.id,campaignId:result.id})).toMatchObject({campaign:{version:1,status:"draft",conditions:campaign.conditions}});
  const update={action:"campaigns.update",campaignId:result.id,expectedVersion:1,campaign:{...campaign,name:"Updated"}};
  expect(await authenticatedApiOperation(db,header,update)).toMatchObject({version:2});
  await expect(authenticatedApiOperation(db,header,update)).rejects.toThrow("CAMPAIGN_CONFLICT");
  await expect(authenticatedApiOperation(db,header,{...update,expectedVersion:2,campaign:{...campaign,batchId:other.id}})).rejects.toThrow("CAMPAIGN_CONFLICT");
  const read=await createApiToken(db,{name:"Read",scopes:["campaigns:read"],productIds:[a.id]});
  await expect(authenticatedApiOperation(db,`Bearer ${read.token}`,update)).rejects.toThrow("API_SCOPE_DENIED");
  const foreign=await createApiToken(db,{name:"Foreign",scopes:["campaigns:read","campaigns:write"],productIds:[b.id]});
  await expect(authenticatedApiOperation(db,`Bearer ${foreign.token}`,{action:"campaigns.get",productId:b.id,campaignId:result.id})).rejects.toThrow("CAMPAIGN_NOT_FOUND");
  await expect(authenticatedApiOperation(db,`Bearer ${foreign.token}`,{...update,campaign:{...campaign,productId:b.id,batchId:other.id}})).rejects.toThrow("CAMPAIGN_NOT_FOUND");
 }finally{sqlite.close();}
});

it("私密連結 API 只建立於授權活動，列表不洩漏秘密，撤銷不跨活動",async()=>{
 const {createCampaign}=await import("../src/lib/server/campaigns");
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:"App",slug:"app"}),q=await createProduct(db,{name:"Other",slug:"other"});
  const b=await createBatch(db,secret,{productId:p.id,name:"Codes",kind:"external",source:"manual",codes:["one"]});
  const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:"Launch",slug:"launch",visibility:"private",conditions:{type:"always"}});
  const d=await createCampaign(db,{productId:p.id,batchId:b.id,name:"Other",slug:"other",visibility:"private",conditions:{type:"always"}});
  const writer=await createApiToken(db,{name:"Write",scopes:["campaigns:read","campaigns:write"],productIds:[p.id]});
  const reader=await createApiToken(db,{name:"Read",scopes:["campaigns:read"],productIds:[p.id]});
  const create={action:"links.create",productId:p.id,campaignId:c.id,link:{maxClaims:1}};
  const header=`Bearer ${writer.token}`;
  await expect(authenticatedApiOperation(db,`Bearer ${reader.token}`,create)).rejects.toThrow("API_SCOPE_DENIED");
  await expect(authenticatedApiOperation(db,header,{...create,productId:q.id})).rejects.toThrow("API_SCOPE_DENIED");
  const link=await authenticatedApiOperation(db,header,create) as {id:string;token:string;path:string};
  expect(link.token).toMatch(/^[a-f0-9]{64}$/);expect(link.path).toBe(`/claim/launch#token=${link.token}`);
  const list=await authenticatedApiOperation(db,`Bearer ${reader.token}`,{action:"links.read",productId:p.id,campaignId:c.id});
  expect(list).toMatchObject({links:[{id:link.id,max_claims:1,claimed_count:0}]});
  expect(JSON.stringify(list)).not.toContain(link.token);expect(JSON.stringify(list)).not.toContain("token_hash");
  const revoke={action:"links.revoke",productId:p.id,campaignId:d.id,linkId:link.id};
  await authenticatedApiOperation(db,header,revoke);
  expect(sqlite.prepare("SELECT revoked_at FROM campaign_links WHERE id=?").get(link.id)?.revoked_at).toBeNull();
  await authenticatedApiOperation(db,header,{...revoke,campaignId:c.id});
  const timestamp=sqlite.prepare("SELECT revoked_at FROM campaign_links WHERE id=?").get(link.id)?.revoked_at;
  expect(timestamp).not.toBeNull();
  await authenticatedApiOperation(db,header,{...revoke,campaignId:c.id});
  expect(sqlite.prepare("SELECT revoked_at FROM campaign_links WHERE id=?").get(link.id)?.revoked_at).toBe(timestamp);
 }finally{sqlite.close();}
});

it("憑證管理 API 限制寫入權限並且列表不回傳秘密或雜湊",async()=>{
 const {createCampaign}=await import("../src/lib/server/campaigns");
 const {verifyCampaignCredential}=await import("../src/lib/server/campaign-credentials");
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:"App",slug:"app"});
  const b=await createBatch(db,secret,{productId:p.id,name:"Codes",kind:"external",source:"manual",codes:["one"]});
  const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:"Launch",slug:"launch",conditions:{type:"always"}});
  const token=await createApiToken(db,{name:"Write",scopes:["campaigns:write","campaigns:read"],productIds:[p.id]});
  const reader=await createApiToken(db,{name:"Read",scopes:["campaigns:read"],productIds:[p.id]});
  const header=`Bearer ${token.token}`;
  const save={action:"credentials.save",productId:p.id,campaignId:c.id,credential:{id:"invite",kind:"invitation",secret:"fixture-invitation-secret"}};
  await expect(authenticatedApiOperation(db,`Bearer ${reader.token}`,save)).rejects.toThrow("API_SCOPE_DENIED");
  expect(await authenticatedApiOperation(db,header,save)).toEqual({id:"invite",kind:"invitation"});
  expect(await verifyCampaignCredential(db,c.id,"invite",save.credential.secret,"invitation")).toBe(true);
  const list=await authenticatedApiOperation(db,header,{action:"credentials.read",productId:p.id,campaignId:c.id});
  expect(list).toEqual({credentials:[{id:"invite",kind:"invitation",revoked_at:null}]});
  await authenticatedApiOperation(db,header,{action:"credentials.revoke",productId:p.id,campaignId:c.id,credential:{id:"invite",kind:"invitation"}});
  expect(await verifyCampaignCredential(db,c.id,"invite",save.credential.secret,"invitation")).toBe(false);
  expect(sqlite.prepare("SELECT version FROM campaigns WHERE id=?").get(c.id)?.version).toBe(3);
 }finally{sqlite.close();}
});

it('批次 API 產碼與匯入重試不重建，補貨後仍回傳原始收據',async()=>{
 const {restockBatch}=await import('../src/lib/server/restock');
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'App',slug:'app'});
  const token=await createApiToken(db,{name:'Inventory',scopes:['codes:write'],productIds:[p.id]});
  const services={claims:{encryptionSecret:secret,identitySecret:'fixture',purchasedCount:async()=>0,qualify:async()=>({allowed:false})}};
  const header=`Bearer ${token.token}`;
  const generate={action:'batches.generate',idempotencyKey:crypto.randomUUID(),batch:{productId:p.id,name:'Generated',kind:'license',rules:{count:3,prefix:'QA-'}}};
  const receipt=await authenticatedApiOperation(db,header,generate,services) as {id:string;count:number};
  expect(receipt.count).toBe(3);expect(await authenticatedApiOperation(db,header,generate,services)).toEqual(receipt);
  expect(sqlite.prepare('SELECT count(*) n FROM codes').get()?.n).toBe(3);
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(1);
  await restockBatch(db,secret,{productId:p.id,batchId:receipt.id,codes:['extra'],idempotencyKey:crypto.randomUUID()});
  expect(await authenticatedApiOperation(db,header,generate,services)).toEqual(receipt);
  await expect(authenticatedApiOperation(db,header,{...generate,batch:{...generate.batch,rules:{count:4}}},services)).rejects.toThrow('BATCH_IDEMPOTENCY_CONFLICT');
  await expect(authenticatedApiOperation(db,header,{...generate,batch:{...generate.batch,productId:crypto.randomUUID()}},services)).rejects.toThrow('API_SCOPE_DENIED');
  await expect(authenticatedApiOperation(db,header,{...generate,batch:{...generate.batch,kind:'external'}},services)).rejects.toThrow();
  const imported={action:'batches.create',idempotencyKey:crypto.randomUUID(),batch:{productId:p.id,name:'Imported',kind:'external',source:'import',codes:['000-first','000-second']}};
  const saved=await authenticatedApiOperation(db,header,imported,services);
  expect(await authenticatedApiOperation(db,header,imported,services)).toEqual(saved);
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(2);
  expect(JSON.stringify(saved)).not.toContain('000-first');
 }finally{sqlite.close();}
});

it('銷售批次與權益設定 API 隔離商品、權限及版本，設定可實際兌換',async()=>{
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'App',slug:'app'}),q=await createProduct(db,{name:'Other',slug:'other'});
  const b=await createBatch(db,secret,{productId:p.id,name:'Codes',kind:'redemption',source:'manual',codes:['permanent-fixture']});
  const other=await createBatch(db,secret,{productId:q.id,name:'Other',kind:'redemption',source:'manual',codes:['other']});
  const token=await createApiToken(db,{name:'Settings',scopes:['products:write','rewards:read','rewards:write','codes:redeem','entitlements:read'],productIds:[p.id]});
  const header=`Bearer ${token.token}`;
  await expect(authenticatedApiOperation(db,header,{action:'sales.configure',productId:p.id,batchId:other.id})).rejects.toThrow('INVALID_SALES_BATCH');
  expect(await authenticatedApiOperation(db,header,{action:'sales.configure',productId:p.id,batchId:b.id})).toEqual({ok:true});
  expect(sqlite.prepare('SELECT checkout_batch_id FROM products WHERE id=?').get(p.id)?.checkout_batch_id).toBe(b.id);
  await authenticatedApiOperation(db,header,{action:'sales.configure',productId:p.id,batchId:null});
  expect(sqlite.prepare('SELECT checkout_batch_id FROM products WHERE id=?').get(p.id)?.checkout_batch_id).toBeNull();
  const rule={action:'rewards.configure',productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'permanent',plan:'pro'}};
  const ordinary=await createApiToken(db,{name:'Inventory',scopes:['codes:write'],productIds:[p.id]});
  await expect(authenticatedApiOperation(db,`Bearer ${ordinary.token}`,rule)).rejects.toThrow('API_SCOPE_DENIED');
  expect(await authenticatedApiOperation(db,header,rule)).toMatchObject({version:1});
  expect(await authenticatedApiOperation(db,header,{action:'rewards.read',productId:p.id,batchId:b.id})).toMatchObject({rule:{version:1,reward:{kind:'permanent',plan:'pro'}}});
  await expect(authenticatedApiOperation(db,header,{action:'rewards.read',productId:p.id,batchId:other.id})).rejects.toThrow('REWARD_SOURCE_UNAVAILABLE');
  await expect(authenticatedApiOperation(db,header,{...rule,expectedVersion:3})).rejects.toThrow('REWARD_CHANGED');
  const redeemed=await authenticatedApiOperation(db,header,{action:'codes.redeem',productId:p.id,userId:'customer',code:'permanent-fixture',idempotencyKey:crypto.randomUUID()});
  expect(redeemed).toMatchObject({reward:{kind:'permanent',plan:'pro'}});
  expect(await authenticatedApiOperation(db,header,{action:'entitlements.read',productId:p.id,userId:'customer',plan:'pro'})).toMatchObject({active:true,permanent:true});
 }finally{sqlite.close();}
});
