import {it,expect} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
import {ensureCreditWallet,applyCreditOperation} from '../src/lib/server/credits';
import {saveRewardRule,redeemCode} from '../src/lib/server/redemptions';
import {readProductEntitlements} from '../src/lib/server/admin-entitlements';
const day=86400000;
async function setup(){
 const database=testDatabase(),{db,sqlite}=database;
 const p=await createProduct(db,{name:'App',slug:'app'}),other=await createProduct(db,{name:'Other',slug:'other'});
 sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('owner','Owner','owner@example.test',1,0,0);
 return {...database,p,other};
}
it('額度列表以商品及精確帳號／信箱篩選，支援無帳號 API 身分與穩定分頁',async()=>{
 const {db,sqlite,p,other}=await setup();try{
  await ensureCreditWallet(db,{productId:p.id,userId:'owner',bucket:'tokens'});
  await ensureCreditWallet(db,{productId:other.id,userId:'owner',bucket:'private'});
  for(let i=0;i<25;i++)await ensureCreditWallet(db,{productId:p.id,userId:`api-${i}`,bucket:'tokens'});
  const first=await readProductEntitlements(db,p.id,{view:'credits'}),second=await readProductEntitlements(db,p.id,{view:'credits',page:2});
  if(first.view!=='credits'||second.view!=='credits')throw new Error('wrong view');
  expect(first.items).toHaveLength(25);expect(first.hasMore).toBe(true);expect(second.items).toHaveLength(1);expect(second.hasMore).toBe(false);
  expect(new Set([...first.items,...second.items].map(row=>row.id)).size).toBe(26);
  const byEmail=await readProductEntitlements(db,p.id,{view:'credits',query:' OWNER@EXAMPLE.TEST '});
  if(byEmail.view!=='credits')throw new Error('wrong view');
  expect(byEmail.items).toHaveLength(1);expect(byEmail.items[0]).toMatchObject({user_id:'owner',bucket:'tokens'});
  expect(await readProductEntitlements(db,p.id,{view:'credits',query:'%'})).toMatchObject({items:[]});
  expect(await readProductEntitlements(db,p.id,{view:'credits',query:'api-12'})).toMatchObject({items:[{user_id:'api-12',email:null}]});
 }finally{sqlite.close();}
});

it('帳本區分請求金額與餘額變化、撤銷來源的已消耗與未退回部分，不曝露冪等鍵',async()=>{
 const {db,sqlite,p,other}=await setup();try{
  const w=await ensureCreditWallet(db,{productId:p.id,userId:'owner',bucket:'tokens'});
  const op=(kind:'grant'|'spend'|'refund'|'revoke',amount:number,relatedId:string|null=null)=>applyCreditOperation(db,{walletId:w.id,kind,amount,relatedId,idempotencyKey:`PRIVATE-${crypto.randomUUID()}`});
  const grant=await op('grant',100,'grant-source'),spend=await op('spend',60);
  await op('grant',200,'unrelated-source');await op('revoke',0,grant.id);await op('refund',20,spend.id);
  const result=await readProductEntitlements(db,p.id,{view:'wallet',walletId:w.id});
  if(result.view!=='wallet')throw new Error('wrong view');
  expect(result.wallet.balance).toBe(200);expect(result.email).toBe('owner@example.test');
  expect(result.operations.find(op=>op.kind==='refund')).toMatchObject({amount:20,balance_delta:0,related_id:spend.id});
  expect(result.sources.find(s=>s.id===grant.id)).toMatchObject({granted:100,available:0,reclaimed:40,consumed_outstanding:40,withheldRefund:20});
  expect(result.sources.find(s=>s.source_id==='unrelated-source')).toMatchObject({available:200,revoked_at:null});
  expect(JSON.stringify(result)).not.toContain('PRIVATE-');expect(JSON.stringify(result)).not.toContain('idempotency_key');
  await expect(readProductEntitlements(db,other.id,{view:'wallet',walletId:w.id})).rejects.toThrow('CREDIT_WALLET_NOT_FOUND');
 }finally{sqlite.close();}
});

it('額度交易與來源獨立分頁，不漏掉同時間寫入的紀錄',async()=>{
 const {db,sqlite,p}=await setup();try{
  const w=await ensureCreditWallet(db,{productId:p.id,userId:'owner',bucket:'tokens'});
  for(let i=0;i<26;i++){
   await applyCreditOperation(db,{walletId:w.id,kind:'grant',amount:2,relatedId:`source-${i}`,idempotencyKey:`grant-${i}`});
   await applyCreditOperation(db,{walletId:w.id,kind:'spend',amount:1,idempotencyKey:`spend-${i}`});
  }
  sqlite.prepare('UPDATE credit_operations SET created_at=1').run();sqlite.prepare('UPDATE credit_grants SET created_at=1').run();
  const first=await readProductEntitlements(db,p.id,{view:'wallet',walletId:w.id}),second=await readProductEntitlements(db,p.id,{view:'wallet',walletId:w.id,page:2,sourcesPage:2});
  if(first.view!=='wallet'||second.view!=='wallet')throw new Error('wrong view');
  expect(first.operations).toHaveLength(50);expect(first.hasMore).toBe(true);expect(first.sources).toHaveLength(25);expect(first.sourcesHasMore).toBe(true);
  expect(second.operations).toHaveLength(2);expect(second.hasMore).toBe(false);expect(second.sources).toHaveLength(1);expect(second.sourcesHasMore).toBe(false);
  expect(new Set([...first.operations,...second.operations].map(r=>r.id)).size).toBe(52);
  expect(new Set([...first.sources,...second.sources].map(r=>r.id)).size).toBe(26);
 }finally{sqlite.close();}
});

it('會員列表與來源顯示撤銷缺口、永久替換及不回收權益，而不是僅看最大到期日',async()=>{
 const {db,sqlite,p,other}=await setup();try{
  const b=await createBatch(db,'ab'.repeat(32),{productId:p.id,name:'Rewards',kind:'redemption',source:'manual',codes:['PRIVATE-A','PRIVATE-B','PRIVATE-C','PRIVATE-D','PRIVATE-E']});
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'membership',plan:'pro',days:10}});
  const redeem=(code:string,at:number)=>redeemCode(db,'owner',{productId:p.id,code,idempotencyKey:crypto.randomUUID()},at);
  const first=await redeem('PRIVATE-A',day);await redeem('PRIVATE-B',2*day);
  sqlite.prepare('UPDATE redemptions SET revoked_at=? WHERE id=?').run(3*day,first.id);
  const gap=await readProductEntitlements(db,p.id,{view:'membership',userId:'owner',plan:'pro'},4*day);
  expect(gap).toMatchObject({active:false,permanent:false,expiresAt:null});
  if(gap.view!=='membership')throw new Error('wrong view');expect(gap.sources).toHaveLength(2);expect(gap.sources.find(s=>s.id===first.id)?.revoked_at).toBe(3*day);
  expect(await readProductEntitlements(db,p.id,{view:'memberships',query:'OWNER@example.test'},11*day)).toMatchObject({items:[{active:true,expiresAt:21*day,source_count:2}]});
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:1,reward:{kind:'permanent',plan:'lifetime',reclaimOnRevoke:false}});
  const permanent=await redeem('PRIVATE-C',day);sqlite.prepare('UPDATE redemptions SET revoked_at=? WHERE id=?').run(2*day,permanent.id);
  const retained=await readProductEntitlements(db,p.id,{view:'membership',userId:'owner',plan:'lifetime'},3*day);
  expect(retained).toMatchObject({active:true,permanent:true,sources:[{revoked_at:null,redemption_revoked_at:2*day}]});
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:2,reward:{kind:'permanent',plan:'replaceable'}});
  const original=await redeem('PRIVATE-D',day);
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:3,reward:{kind:'membership',plan:'replaceable',repeat:'replace',days:5}});
  const replacement=await redeem('PRIVATE-E',2*day);
  const replaced=await readProductEntitlements(db,p.id,{view:'membership',userId:'owner',plan:'replaceable'},3*day);
  expect(replaced).toMatchObject({active:true,permanent:false,expiresAt:7*day});
  if(replaced.view!=='membership')throw new Error('wrong view');expect(replaced.sources.find(s=>s.id===original.id)?.replaced_by).toBe(replacement.id);
  expect(JSON.stringify(replaced)).not.toContain('PRIVATE-');
  await expect(readProductEntitlements(db,other.id,{view:'membership',userId:'owner',plan:'pro'})).rejects.toThrow('ENTITLEMENT_NOT_FOUND');
  await expect(readProductEntitlements(db,p.id,{view:'membership',userId:'stranger',plan:'pro'})).rejects.toThrow('ENTITLEMENT_NOT_FOUND');
 }finally{sqlite.close();}
});

it('會員與發放來源各自提供完整分頁，API 身分不需要本機帳號',async()=>{
 const {db,sqlite,p}=await setup();try{
  const codes=Array.from({length:52},(_,i)=>`CODE-${i}`);
  const b=await createBatch(db,'ab'.repeat(32),{productId:p.id,name:'Rewards',kind:'redemption',source:'manual',codes});
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'membership',plan:'pro',days:1}});
  for(let i=0;i<52;i++)await redeemCode(db,i<26?'api-owner':`api-${i}`,{productId:p.id,code:codes[i],idempotencyKey:crypto.randomUUID()},day);
  const first=await readProductEntitlements(db,p.id,{view:'memberships'},2*day),second=await readProductEntitlements(db,p.id,{view:'memberships',page:2},2*day);
  if(first.view!=='memberships'||second.view!=='memberships')throw new Error('wrong view');
  expect(first.items).toHaveLength(25);expect(first.hasMore).toBe(true);expect(second.items).toHaveLength(2);expect(second.hasMore).toBe(false);
  expect(new Set([...first.items,...second.items].map(s=>s.user_id)).size).toBe(27);
  const detail=await readProductEntitlements(db,p.id,{view:'membership',userId:'api-owner',plan:'pro',page:2},2*day);
  expect(detail).toMatchObject({active:true,expiresAt:27*day,email:null,hasMore:false});
  if(detail.view!=='membership')throw new Error('wrong view');expect(detail.sources).toHaveLength(1);
 }finally{sqlite.close();}
});
