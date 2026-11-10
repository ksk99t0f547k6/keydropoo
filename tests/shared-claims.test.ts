import {it,expect} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch,changeCodeStatus,listBatches} from '../src/lib/server/inventory';
import {createCampaign,setCampaignStatus} from '../src/lib/server/campaigns';
import {claimCode,createCampaignLink,type ClaimServices} from '../src/lib/server/claims';
import {saveRewardRule,redeemCode} from '../src/lib/server/redemptions';
import {setSalesBatch} from '../src/lib/server/sales';
import {reserveOrder} from '../src/lib/server/orders';
const services:ClaimServices={encryptionSecret:'ab'.repeat(32),identitySecret:'fixture-identity-at-least-32-characters',purchasedCount:async()=>0,qualify:async()=>({allowed:false}),now:()=>1000};
async function setup(limit:number|null=2){
 const database=testDatabase();const {db}=database;
 const p=await createProduct(db,{name:'Shared',slug:'shared',priceMinor:500});
 const b=await createBatch(db,services.encryptionSecret,{productId:p.id,name:'Shared',kind:'redemption',source:'manual',codes:['SHARED'],distributionMode:'shared',sharedClaimLimit:limit,maxUses:10});
 async function campaign(slug:string,extra={}){
  const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:slug,slug,conditions:{type:'always'},...extra});await setCampaignStatus(db,c.id,1,'active');return c;
 }
 const c=await campaign('launch');return {...database,p,b,c,campaign};
}
function claim(db:D1Database,campaignId:string,userId:string,extra={}){return claimCode(db,{campaignId,idempotencyKey:crypto.randomUUID(),...extra},{userId,emailVerified:false},services);}
it('共用碼跨活動共享領取上限，最後名額競爭不超發，重試不計次',async()=>{
 const {db,sqlite,b,c,campaign,p}=await setup();try{
  const other=await campaign('other');const key=crypto.randomUUID();
  const first=await claim(db,c.id,'a',{idempotencyKey:key});
  expect(await claim(db,c.id,'a',{idempotencyKey:key})).toEqual(first);
  const competing=await Promise.allSettled([claim(db,c.id,'b'),claim(db,other.id,'c')]);
  expect(competing.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(competing.find(r=>r.status==='fulfilled')).toMatchObject({value:{code:first.code}});
  expect(sqlite.prepare('SELECT count(*) n FROM claims').get()?.n).toBe(2);
  expect(sqlite.prepare('SELECT use_count FROM codes').get()?.use_count).toBe(0);
  expect(sqlite.prepare("SELECT count(*) n FROM webhook_events WHERE type='code.claimed'").get()?.n).toBe(2);
  expect((await listBatches(db,p.id))[0]).toMatchObject({id:b.id,distribution_mode:'shared',shared_claim_limit:2});
  await expect(claim(db,c.id,'d')).rejects.toThrow('CLAIM_UNAVAILABLE');
 }finally{sqlite.close();}
});
it('共用碼仍遵守每人、連結與撤銷限制，沒有每碼上限不代表無活動上限',async()=>{
 const {db,sqlite,c,p}=await setup(null);try{
  await claim(db,c.id,'a');await expect(claim(db,c.id,'a')).rejects.toThrow('CLAIM_UNAVAILABLE');
  const link=await createCampaignLink(db,c.id,{maxClaims:1});
  await claim(db,c.id,'b',{linkToken:link.token});
  await expect(claim(db,c.id,'c',{linkToken:link.token})).rejects.toThrow('CLAIM_LINK_UNAVAILABLE');
  const code=sqlite.prepare('SELECT id FROM codes').get()!.id;
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:'revoke'});
  await expect(claim(db,c.id,'d')).rejects.toThrow('CLAIM_UNAVAILABLE');
 }finally{sqlite.close();}
});
it('共用碼兌換採用本人活動規則，不套用別人的獎勵；每人同碼只兌換一次',async()=>{
 const {db,sqlite,c,p,b,campaign}=await setup(null);try{
  const other=await campaign('other');
  for(const [campaignId,amount] of [[null,1],[c.id,10],[other.id,20]] as const)await saveRewardRule(db,{productId:p.id,batchId:b.id,campaignId,expectedVersion:0,reward:{kind:'credits',bucket:'quota',amount}});
  await claim(db,c.id,'a');await claim(db,other.id,'b');
  const redeem=(userId:string)=>redeemCode(db,userId,{productId:p.id,code:'SHARED',idempotencyKey:crypto.randomUUID()},1001);
  await expect(redeem('stranger')).rejects.toThrow('REDEMPTION_UNAVAILABLE');
  expect(await redeem('a')).toMatchObject({reward:{amount:10}});
  expect(await redeem('b')).toMatchObject({reward:{amount:20}});
  await expect(redeem('a')).rejects.toThrow();
  expect(sqlite.prepare('SELECT use_count FROM codes').get()?.use_count).toBe(2);
  expect(sqlite.prepare('SELECT user_id,balance FROM credit_wallets ORDER BY user_id').all()).toEqual([{user_id:'a',balance:10},{user_id:'b',balance:20}]);
 }finally{sqlite.close();}
});
it('共用銷售可設定庫存，啟用碼亦可建立共用批次',async()=>{
 const {db,sqlite,p,b}=await setup();try{
  expect(await setSalesBatch(db,p.id,b.id)).toEqual({ok:true});
  expect(await reserveOrder(db,{productId:p.id,batchId:b.id,buyerKey:'buyer',idempotencyKey:crypto.randomUUID()})).toMatchObject({status:'pending'});
  expect(await createBatch(db,services.encryptionSecret,{productId:p.id,name:'License',kind:'license',source:'manual',codes:['LICENSE'],distributionMode:'shared'})).toMatchObject({count:1});
  expect(sqlite.prepare('SELECT count(*) n FROM orders').get()?.n).toBe(1);
 }finally{sqlite.close();}
});
it('升級保留既有領取與事件，舊批次維持獨立碼及外鍵一致',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync,readdirSync}=await import('node:fs');
 const sqlite=new DatabaseSync(':memory:');try{
  sqlite.exec('PRAGMA foreign_keys=ON');
  const directory=new URL('../migrations/',import.meta.url);
  for(const file of readdirSync(directory).filter(name=>name.endsWith('.sql')&&name<'0019').sort())sqlite.exec(readFileSync(new URL(file,directory),'utf8'));
  sqlite.exec(`INSERT INTO products(id,name,slug,created_at,updated_at) VALUES('p','Product','p',1,1);
   INSERT INTO code_batches(id,product_id,name,kind,source,created_at) VALUES('b','p','Batch','external','manual',1);
   INSERT INTO codes(id,product_id,batch_id,fingerprint,ciphertext,created_at) VALUES('k','p','b','hash','encrypted',1);`);
  const columns=sqlite.prepare('PRAGMA table_info(campaigns)').all();expect(columns.length).toBeGreaterThan(0);
  sqlite.exec(`INSERT INTO campaigns(id,product_id,batch_id,name,slug,status,conditions_json,created_at,updated_at) VALUES('c','p','b','Launch','launch','active','{"type":"always"}',1,1);
   INSERT INTO claims(id,campaign_id,campaign_version,code_id,subject_key,idempotency_key,created_at) VALUES('claim','c',1,'k','subject','request',2);`);
  const before=sqlite.prepare('SELECT * FROM claims').all();const events=sqlite.prepare('SELECT * FROM webhook_events').all();
  sqlite.exec(readFileSync(new URL('0019_shared_claims.sql',directory),'utf8'));
  expect(sqlite.prepare('SELECT * FROM claims').all()).toEqual(before);
  expect(sqlite.prepare('SELECT * FROM webhook_events').all()).toEqual(events);
  expect(sqlite.prepare('SELECT distribution_mode FROM code_batches').get()?.distribution_mode).toBe('unique');
  expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(()=>sqlite.exec(`INSERT INTO claims(id,campaign_id,campaign_version,code_id,subject_key,idempotency_key,created_at) VALUES('second','c',1,'k','other','other',3)`)).toThrow('CLAIM_UNAVAILABLE');
 }finally{sqlite.close();}
});
