import {it,expect} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
import {reserveOrder,attachCheckout,settleOrder,refundOrder,expireReservations,deliverOrder,type OrderRow} from '../src/lib/server/orders';
import {createCampaign,setCampaignStatus} from '../src/lib/server/campaigns';
import {claimCode,type ClaimServices} from '../src/lib/server/claims';
import {redeemCode,saveRewardRule} from '../src/lib/server/redemptions';
import {listMyCodes} from '../src/lib/server/my-codes';
import {queueCodeEmail} from '../src/lib/server/code-email';
import {restockBatch} from '../src/lib/server/restock';
import {maintainOrders} from '../src/lib/server/order-maintenance';
const secret='ab'.repeat(32);
async function setup(limit=2,extra={}){
 const database=testDatabase(),{db,sqlite}=database;
 for(const user of ['a','b'])sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,0,0)').run(user,user,`${user}@example.test`);
 const p=await createProduct(db,{name:'Shared',slug:'shared',priceMinor:500,...extra});
 const b=await createBatch(db,secret,{productId:p.id,name:'Shared',kind:'redemption',source:'manual',codes:['SHARED'],distributionMode:'shared',sharedClaimLimit:limit,maxUses:20});
 await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'credits',bucket:'quota',amount:10}});
 const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:'Free',slug:'free',conditions:{type:'always'}});await setCampaignStatus(db,c.id,1,'active');
 const reserve=(buyer:string,now=1000)=>reserveOrder(db,{productId:p.id,batchId:b.id,buyerKey:buyer,userId:buyer,idempotencyKey:crypto.randomUUID()},now);
 const claim=(userId:string,now=1000)=>claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{userId,emailVerified:false},{encryptionSecret:secret,identitySecret:'fixture-identity-at-least-32-characters',purchasedCount:async()=>0,qualify:async()=>({allowed:false}),now:()=>now} satisfies ClaimServices);
 return {...database,p,b,reserve,claim};
}
async function pay(db:D1Database,o:OrderRow,now=2000){await attachCheckout(db,o.id,`cs_${o.id.replaceAll('-','')}`);return settleOrder(db,{orderId:o.id,sessionId:`cs_${o.id.replaceAll('-','')}`,paymentIntentId:`pi_${o.id}`,amountMinor:500,currency:'USD'},now);}
it('兩位買家預留及付款可取得同碼，免費領取與訂單共用名額，不重複交付',async()=>{
 const {db,sqlite,reserve,claim}=await setup();try{
  const a=await reserve('a'),b=await reserve('b');expect(a.reserved_code_id).toBe(b.reserved_code_id);
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('available');
  await expect(reserve('c')).rejects.toThrow('ORDER_STOCK_UNAVAILABLE');
  await expect(claim('free')).rejects.toThrow('CLAIM_UNAVAILABLE');
  const first=await pay(db,a);const second=await pay(db,b);expect(first.code_id).toBe(second.code_id);
  expect(await pay(db,a)).toMatchObject({code_id:first.code_id,status:'fulfilled'});
  expect(sqlite.prepare("SELECT count(*) n FROM webhook_events WHERE type='order.delivered'").get()?.n).toBe(2);
  expect((await deliverOrder(db,secret,a.id,'a')).code).toBe('SHARED');
 }finally{sqlite.close();}
});
it('共用最後名額在購買與免費活動競爭時只成功一次',async()=>{
 const {sqlite,reserve,claim}=await setup(1);try{
  const results=await Promise.allSettled([reserve('a'),claim('b')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(sqlite.prepare('SELECT count(*) n FROM code_distribution_usage').get()?.n).toBe(1);
 }finally{sqlite.close();}
});
it('逾時釋放共用預留，遲到付款尊重已分配名額及原兜底策略',async()=>{
 const {db,sqlite,reserve,claim}=await setup(1);try{
  const a=await reserve('a');await expireReservations(db,a.reserved_until);
  await claim('b',a.reserved_until);
  const paid=await pay(db,a,a.reserved_until+1);expect(paid).toMatchObject({status:'refund_pending',code_id:null});
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('assigned');
 }finally{sqlite.close();}
});
it('共用退款只回收來源訂單的權益，其他買家及原碼維持有效，撤銷持有權不再寄碼',async()=>{
 const {db,sqlite,p,reserve}=await setup();try{
  const a=await pay(db,await reserve('a')),b=await pay(db,await reserve('b'));
  for(const userId of ['a','b'])await redeemCode(db,userId,{productId:p.id,code:'SHARED',idempotencyKey:crypto.randomUUID()},3000);
  const refunded=await refundOrder(db,a.payment_intent_id!,500,4000);expect(refunded.access_revoked_at).toBe(4000);
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('assigned');
  expect(sqlite.prepare('SELECT user_id,balance FROM credit_wallets ORDER BY user_id').all()).toEqual([{user_id:'a',balance:0},{user_id:'b',balance:10}]);
  expect((await deliverOrder(db,secret,a.id,'a')).code).toBeNull();expect((await deliverOrder(db,secret,b.id,'b')).code).toBe('SHARED');
  expect((await listMyCodes(db,secret,'a')).items[0]).toMatchObject({status:'revoked',code:null});
  await expect(queueCodeEmail(db,'a',{codeId:a.code_id,idempotencyKey:crypto.randomUUID()})).rejects.toThrow('EMAIL_CODE_UNAVAILABLE');
  expect(await queueCodeEmail(db,'b',{codeId:b.code_id,idempotencyKey:crypto.randomUUID()})).toMatchObject({status:'pending'});
  await expect(reserve('c',5000)).rejects.toThrow('ORDER_STOCK_UNAVAILABLE');
  await refundOrder(db,a.payment_intent_id!,500,6000);expect(sqlite.prepare("SELECT balance FROM credit_wallets WHERE user_id='b'").get()?.balance).toBe(10);
 }finally{sqlite.close();}
});
it('共用全額退款前未兌換的買家被拒絕，關閉退款撤銷仍可兌換',async()=>{
 for(const revokeOnRefund of [true,false]){
  const {db,sqlite,p,reserve}=await setup(2,{revokeOnRefund});try{
   const a=await pay(db,await reserve('a'));await pay(db,await reserve('b'));
   await refundOrder(db,a.payment_intent_id!,500,4000);
   const redeem=redeemCode(db,'a',{productId:p.id,code:'SHARED',idempotencyKey:crypto.randomUUID()},5000);
   if(revokeOnRefund)await expect(redeem).rejects.toThrow('REDEMPTION_UNAVAILABLE');else expect(await redeem).toMatchObject({reward:{amount:10}});
  }finally{sqlite.close();}
 }
});
it('共用 backorder 可在原批次補貨後交付，排程重跑不重複分配',async()=>{
 const {db,sqlite,p,b,reserve,claim}=await setup(1,{shortagePolicy:'backorder'});try{
  const a=await reserve('a');await expireReservations(db,a.reserved_until);await claim('b',a.reserved_until);
  expect(await pay(db,a,a.reserved_until+1)).toMatchObject({status:'backorder'});
  expect((await maintainOrders(db,a.reserved_until+2)).fulfilled).toBe(0);
  await restockBatch(db,secret,{productId:p.id,batchId:b.id,codes:['RESTOCK'],maxUses:10,idempotencyKey:crypto.randomUUID()});
  expect((await maintainOrders(db,a.reserved_until+3)).fulfilled).toBe(1);
  expect((await maintainOrders(db,a.reserved_until+4)).fulfilled).toBe(0);
  expect((await deliverOrder(db,secret,a.id,'a')).code).toBe('RESTOCK');
 }finally{sqlite.close();}
});
it('部分退款不撤銷共用持有權，完整退款依來源保留已消耗額度與其他人的權益',async()=>{
 const {db,sqlite,p,reserve}=await setup();try{
  const {manageCredits}=await import('../src/lib/server/credits');
  const a=await pay(db,await reserve('a'));await pay(db,await reserve('b'));
  await redeemCode(db,'a',{productId:p.id,code:'SHARED',idempotencyKey:crypto.randomUUID()},3000);
  await manageCredits(db,{wallet:{productId:p.id,userId:'a',bucket:'quota'},operation:{kind:'spend',amount:4,idempotencyKey:'spent'}});
  const partial=await refundOrder(db,a.payment_intent_id!,100,4000);expect(partial).toMatchObject({access_revoked_at:null,review_required:1});
  expect((await deliverOrder(db,secret,a.id,'a')).code).toBe('SHARED');
  await refundOrder(db,a.payment_intent_id!,500,5000);
  expect(sqlite.prepare('SELECT granted,available,revoked_at FROM credit_grants').get()).toMatchObject({granted:10,available:0,revoked_at:5000});
  expect(sqlite.prepare("SELECT amount FROM credit_operations WHERE kind='spend'").get()?.amount).toBe(4);
  expect(await redeemCode(db,'b',{productId:p.id,code:'SHARED',idempotencyKey:crypto.randomUUID()},6000)).toMatchObject({reward:{amount:10}});
 }finally{sqlite.close();}
});
it('訂單表升級保留既有付款、快照與事件，不重發舊訂單',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync,readdirSync}=await import('node:fs');
 const sqlite=new DatabaseSync(':memory:');try{
  sqlite.exec('PRAGMA foreign_keys=ON');const directory=new URL('../migrations/',import.meta.url);
  for(const file of readdirSync(directory).filter(name=>name.endsWith('.sql')&&name<'0020').sort())sqlite.exec(readFileSync(new URL(file,directory),'utf8'));
  sqlite.exec(`INSERT INTO products(id,name,slug,price_minor,created_at,updated_at) VALUES('p','Product','p',500,1,1);
   INSERT INTO code_batches(id,product_id,name,kind,source,created_at) VALUES('b','p','Batch','external','manual',1);
   INSERT INTO codes(id,product_id,batch_id,fingerprint,ciphertext,created_at) VALUES('k','p','b','hash','encrypted',1);
   INSERT INTO orders(id,product_id,batch_id,buyer_key,user_id,idempotency_key,amount_minor,currency,shortage_policy,revoke_on_refund,reserved_code_id,reserved_until,created_at,updated_at,checkout_payload_json)
   VALUES('o','p','b','buyer','owner','key',500,'USD','refund',1,'k',100,1,1,'{"fixture":"snapshot"}');
   UPDATE orders SET paid_at=2,updated_at=2,checkout_session_id='cs_legacy',payment_intent_id='pi_legacy' WHERE id='o';`);
  const before=sqlite.prepare('SELECT * FROM orders').get()!;const events=sqlite.prepare('SELECT * FROM webhook_events').all();
  sqlite.exec(readFileSync(new URL('0020_shared_orders.sql',directory),'utf8'));
  expect(sqlite.prepare('SELECT * FROM orders').get()).toEqual({...before,access_revoked_at:null});
  expect(sqlite.prepare('SELECT * FROM webhook_events').all()).toEqual(events);
  expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(sqlite.prepare('SELECT count(*) n FROM code_distribution_usage').get()?.n).toBe(1);
 }finally{sqlite.close();}
});
