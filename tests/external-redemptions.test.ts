import {it,expect,vi} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch,changeCodeStatus} from '../src/lib/server/inventory';
import {saveRewardRule,redeemCode} from '../src/lib/server/redemptions';
import type {ExternalDispatcher} from '../src/lib/server/external-redemptions';
import type {ExternalGrant,ExternalRewardReceipt} from '../src/lib/server/external-reward-http';
import {reserveOrder} from '../src/lib/server/orders';
const secret='ab'.repeat(32);
async function setup(){
 const database=testDatabase();const {db}=database;
 const p=await createProduct(db,{name:'External reward',slug:'external',priceMinor:500});
 const b=await createBatch(db,secret,{productId:p.id,name:'Codes',kind:'redemption',source:'manual',codes:['KEY-A','KEY-B']});
 await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'external',integrationId:'partner',payload:{plan:'pro'}}});
 const raw={productId:p.id,code:'KEY-A',idempotencyKey:crypto.randomUUID()};
 return {...database,p,b,raw};
}
it('外部失敗維持未兌換並通知，換請求鍵重試沿用原操作與快照，只完成一次',async()=>{
 const {db,sqlite,p,b,raw}=await setup();try{
  const requests:ExternalGrant[]=[];
  const dispatch=vi.fn<ExternalDispatcher>(async(_id,request)=>{requests.push(request);if(requests.length===1)return {operationId:request.operationId,status:'rejected'};return {operationId:request.operationId,status:'applied'};});
  await expect(redeemCode(db,'owner',raw,Date.now(),dispatch)).rejects.toThrow('EXTERNAL_REDEMPTION_FAILED');
  expect(sqlite.prepare('SELECT count(*) n FROM redemptions').get()?.n).toBe(0);
  expect(sqlite.prepare('SELECT sum(use_count) n FROM codes').get()?.n).toBe(0);
  expect(sqlite.prepare('SELECT state FROM external_redemption_attempts').get()?.state).toBe('retryable');
  expect(sqlite.prepare('SELECT occurrences,resolved_at FROM admin_notifications').get()).toEqual({occurrences:1,resolved_at:null});
  const order=await reserveOrder(db,{productId:p.id,batchId:b.id,buyerKey:'buyer',idempotencyKey:crypto.randomUUID()});
  expect(order.reserved_code_id).not.toBe(requests[0].codeId);
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:1,reward:{kind:'credits',bucket:'changed',amount:99}});
  const retry={...raw,idempotencyKey:crypto.randomUUID()};
  const result=await redeemCode(db,'owner',retry,Date.now(),dispatch);
  expect(requests[1]).toEqual(requests[0]);expect(result.reward).toMatchObject({kind:'external',payload:{plan:'pro'}});
  expect(await redeemCode(db,'owner',raw,Date.now(),dispatch)).toEqual(result);
  expect(await redeemCode(db,'owner',retry,Date.now(),dispatch)).toEqual(result);expect(dispatch).toHaveBeenCalledTimes(2);
  expect(sqlite.prepare('SELECT sum(use_count) n FROM codes').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT count(*) n FROM credit_wallets').get()?.n).toBe(0);
  expect(sqlite.prepare('SELECT resolved_at FROM admin_notifications').get()?.resolved_at).not.toBeNull();
  await expect(redeemCode(db,'owner',{...retry,code:'KEY-B'},Date.now(),dispatch)).rejects.toThrow('REDEMPTION_IDEMPOTENCY_CONFLICT');
 }finally{sqlite.close();}
});
it('在途請求不重送；過期租約轉人工確認，遲到成功不可自行完成',async()=>{
 const {db,sqlite,raw}=await setup();try{
  let release:(value:ExternalRewardReceipt)=>void=()=>{};let started:()=>void=()=>{};const ready=new Promise<void>(r=>{started=r;});let request:ExternalGrant|undefined;
  const pending=redeemCode(db,'owner',raw,Date.now(),async(_id,value)=>{request=value;started();return new Promise(r=>{release=r;});});await ready;
  const second=vi.fn<ExternalDispatcher>(async(_id,value)=>({operationId:value.operationId,status:'applied'}));
  await expect(redeemCode(db,'owner',raw,Date.now(),second)).rejects.toThrow('EXTERNAL_REDEMPTION_BUSY');expect(second).not.toHaveBeenCalled();
  sqlite.prepare('UPDATE external_redemption_attempts SET lease_until=0').run();
  await expect(redeemCode(db,'owner',raw,Date.now(),second)).rejects.toThrow('EXTERNAL_REDEMPTION_REVIEW_REQUIRED');expect(second).not.toHaveBeenCalled();
  const outcome=expect(pending).rejects.toThrow('EXTERNAL_REDEMPTION_REVIEW_REQUIRED');
  release({operationId:request!.operationId,status:'applied'});await outcome;
  expect(sqlite.prepare('SELECT count(*) n FROM redemptions').get()?.n).toBe(0);
  expect(sqlite.prepare('SELECT review_required FROM external_redemption_attempts').get()?.review_required).toBe(1);
 }finally{sqlite.close();}
});
it('明確拒絕或外部完成期間撤銷不消耗碼，通知不包含外部錯誤或原始碼',async()=>{
 const {db,sqlite,p,raw}=await setup();try{
  await expect(redeemCode(db,'owner',raw,Date.now(),async(_id,value)=>({operationId:value.operationId,status:'rejected'}))).rejects.toThrow('EXTERNAL_REDEMPTION_FAILED');
  await expect(redeemCode(db,'owner',raw,Date.now(),async(_id,value)=>{
   await changeCodeStatus(db,{productId:p.id,ids:[value.codeId],action:'revoke'});return {operationId:value.operationId,status:'applied'};
  })).rejects.toThrow('EXTERNAL_REDEMPTION_REVIEW_REQUIRED');
  expect(sqlite.prepare('SELECT count(*) n FROM redemptions').get()?.n).toBe(0);
  const notifications=sqlite.prepare('SELECT * FROM admin_notifications').all();expect(notifications[0].occurrences).toBe(2);
  expect(JSON.stringify(notifications)).not.toContain('KEY-A');expect(JSON.stringify(notifications)).not.toContain('private error');
 }finally{sqlite.close();}
});
it('未確認的外部操作保留使用名額，其他使用者不能超發',async()=>{
 const {db,sqlite,raw}=await setup();try{
  await expect(redeemCode(db,'owner',raw,Date.now(),async()=>{throw new Error('timeout');})).rejects.toThrow('EXTERNAL_REDEMPTION_REVIEW_REQUIRED');
  const send=vi.fn<ExternalDispatcher>();
  await expect(redeemCode(db,'owner',{...raw,idempotencyKey:crypto.randomUUID()},Date.now(),send)).rejects.toThrow('EXTERNAL_REDEMPTION_REVIEW_REQUIRED');
  await expect(redeemCode(db,'other',raw,Date.now(),send)).rejects.toThrow('REDEMPTION_UNAVAILABLE');expect(send).not.toHaveBeenCalled();
 }finally{sqlite.close();}
});
it('撤銷已完成的外部權益會通知管理員處理，關閉回收則不要求外部撤銷',async()=>{
 for(const reclaimOnRevoke of [true,false]){
  const {db,sqlite,p,b,raw}=await setup();try{
   await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:1,reward:{kind:'external',integrationId:'partner',payload:{plan:'pro'},reclaimOnRevoke}});
   const result=await redeemCode(db,'owner',raw,Date.now(),async(_id,value)=>({operationId:value.operationId,status:'applied'}));
   const code=sqlite.prepare('SELECT code_id FROM redemptions WHERE id=?').get(result.id)!.code_id;
   await changeCodeStatus(db,{productId:p.id,ids:[code],action:'revoke'});
   expect(sqlite.prepare("SELECT count(*) n FROM admin_notifications WHERE type='external_revocation_required'").get()?.n).toBe(reclaimOnRevoke?1:0);
  }finally{sqlite.close();}
 }
});
it('人工確認已發放只完成本地帳本、不重送；未發放需附紀錄才解鎖，處理紀錄不可重複',async()=>{
 const {resolveExternalReview,listExternalReviews}=await import('../src/lib/server/external-reviews');
 for(const outcome of ['applied','not_applied'] as const){
  const {db,sqlite,raw}=await setup();try{
   const dispatch=vi.fn<ExternalDispatcher>(async()=>{throw new Error('timeout');});
   await expect(redeemCode(db,'owner',raw,Date.now(),dispatch)).rejects.toThrow('EXTERNAL_REDEMPTION_REVIEW_REQUIRED');
   const [review]=(await listExternalReviews(db)).items;
   await expect(resolveExternalReview(db,'admin',{attemptId:review.id,outcome,note:''})).rejects.toThrow();
   await resolveExternalReview(db,'admin',{attemptId:review.id,outcome,note:'Confirmed with recipient operation log'});
   expect((await listExternalReviews(db)).items).toHaveLength(0);
   expect(sqlite.prepare('SELECT outcome,admin_id FROM external_redemption_reviews').get()).toEqual({outcome,admin_id:'admin'});
   await expect(resolveExternalReview(db,'admin',{attemptId:review.id,outcome,note:'Duplicate review is rejected'})).rejects.toThrow('EXTERNAL_REVIEW_UNAVAILABLE');
   const applied=vi.fn<ExternalDispatcher>(async(_id,value)=>({operationId:value.operationId,status:'applied'}));
   await redeemCode(db,'owner',raw,Date.now(),applied);
   expect(applied).toHaveBeenCalledTimes(outcome==='applied'?0:1);
   expect(sqlite.prepare('SELECT count(*) n FROM redemptions').get()?.n).toBe(1);
   expect(sqlite.prepare('SELECT sum(use_count) n FROM codes').get()?.n).toBe(1);
  }finally{sqlite.close();}
 }
});
it('排程隔離中斷請求；碼已撤銷時人工確認已發放仍記錄兌換，並排入外部撤銷',async()=>{
 const {quarantineExternalAttempts}=await import('../src/lib/server/external-redemptions');
 const {resolveExternalReview}=await import('../src/lib/server/external-reviews');
 const {db,sqlite,p,raw}=await setup();try{
  await expect(redeemCode(db,'owner',raw,Date.now(),async()=>{throw new Error('timeout');})).rejects.toThrow('EXTERNAL_REDEMPTION_REVIEW_REQUIRED');
  const attempt=sqlite.prepare('SELECT id,code_id FROM external_redemption_attempts').get()!;
  sqlite.prepare("UPDATE external_redemption_attempts SET review_required=0,state='sending',lease_until=0,lease_token='old'").run();
  await quarantineExternalAttempts(db);
  expect(sqlite.prepare('SELECT review_required,lease_token FROM external_redemption_attempts').get()).toEqual({review_required:1,lease_token:null});
  await changeCodeStatus(db,{productId:p.id,ids:[attempt.code_id],action:'revoke'});
  // 外部已實際發放：本地必須能記錄，否則之後無法追蹤撤銷。碼維持撤銷，兌換立即標成撤銷並排入外部撤銷。
  await resolveExternalReview(db,'admin',{attemptId:attempt.id,outcome:'applied',note:'Recipient confirms it was applied'});
  expect(sqlite.prepare('SELECT state,review_required FROM external_redemption_attempts').get()).toEqual({state:'applied',review_required:0});
  expect(sqlite.prepare('SELECT count(*) n FROM external_redemption_reviews').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT revoked_at IS NOT NULL revoked FROM redemptions WHERE id=?').get(attempt.id)?.revoked).toBe(1);
  expect(sqlite.prepare('SELECT status FROM codes WHERE id=?').get(attempt.code_id)?.status).toBe('revoked');
  expect(sqlite.prepare("SELECT count(*) n FROM external_revocations WHERE redemption_id=?").get(attempt.id)?.n).toBe(1);
 }finally{sqlite.close();}
});
