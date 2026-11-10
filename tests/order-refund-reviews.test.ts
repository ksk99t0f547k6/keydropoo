import {it,expect} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
import {reserveOrder,attachCheckout,settleOrder,refundOrder,getOrder,deliverOrder,listOrders} from '../src/lib/server/orders';
import {reviewOrderRefund} from '../src/lib/server/order-refund-reviews';
import {saveRewardRule,redeemCode} from '../src/lib/server/redemptions';
import {creditHistory,creditGrantStatus,applyCreditOperation} from '../src/lib/server/credits';
const secret='ab'.repeat(32);
async function setup(kind:'redemption'|'external'|'license'='redemption',mode:'unique'|'shared'='unique'){
 const database=testDatabase(),{db,sqlite}=database;
 for(const user of ['owner','other'])sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,0,0)').run(user,user,`${user}@example.test`);
 const p=await createProduct(db,{name:'Refunds',slug:'refunds',priceMinor:500});
 const b=await createBatch(db,secret,{productId:p.id,name:'Codes',kind,source:'manual',codes:['REFUND-REVIEW-CODE'],distributionMode:mode,maxUses:10});
 async function sale(userId:string){
  const o=await reserveOrder(db,{productId:p.id,batchId:b.id,buyerKey:`buyer-${userId}`,userId,idempotencyKey:crypto.randomUUID()});
  await attachCheckout(db,o.id,`cs_${o.id.replaceAll('-','')}`);
  return settleOrder(db,{orderId:o.id,sessionId:`cs_${o.id.replaceAll('-','')}`,paymentIntentId:`pi_${o.id}`,amountMinor:500,currency:'USD'});
 }
 const order=await sale('owner');return {...database,p,b,order,sale};
}
const review=(orderId:string,decision:'retain'|'revoke'|'acknowledge',refundedMinor=100)=>({orderId,decision,refundedMinor,idempotencyKey:crypto.randomUUID(),note:'Checked the confirmed refund and customer access.'});

it('部分退款人工撤銷僅解除共用啟用碼買家的裝置',async()=>{
 const {activateLicense,validateLicense}=await import('../src/lib/server/licenses');
 const {db,sqlite,p,order,sale}=await setup('license','shared');try{
  await sale('other');const identity='fixture-device-secret-at-least-32-characters';
  const input={productId:p.id,code:'REFUND-REVIEW-CODE',deviceId:'same-device'};
  const a=await activateLicense(db,secret,identity,input,Date.now(),'owner'),b=await activateLicense(db,secret,identity,input,Date.now(),'other');
  await refundOrder(db,order.payment_intent_id!,100);await reviewOrderRefund(db,'admin',review(order.id,'revoke'));
  const proof=(activationToken:string)=>({productId:p.id,deviceId:'same-device',activationToken});
  expect((await validateLicense(db,identity,proof(a.activationToken))).valid).toBe(false);
  expect((await validateLicense(db,identity,proof(b.activationToken))).valid).toBe(true);
 }finally{sqlite.close();}
});

it('撤銷已兌換的外部權益只建立原發放的撤銷工作，不冒稱外部回收完成',async()=>{
 const {db,sqlite,p,b,order}=await setup();try{
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'external',integrationId:'partner',payload:{plan:'pro'}}});
  const redeemed=await redeemCode(db,'owner',{productId:p.id,code:'REFUND-REVIEW-CODE',idempotencyKey:crypto.randomUUID()},Date.now(),async(_id,value)=>({operationId:value.operationId,status:'applied'}));
  await refundOrder(db,order.payment_intent_id!,100);await reviewOrderRefund(db,'admin',review(order.id,'revoke'));
  expect(sqlite.prepare('SELECT redemption_id,status FROM external_revocations').get()).toMatchObject({redemption_id:redeemed.id,status:'pending'});
  expect(sqlite.prepare("SELECT resolved_at FROM admin_notifications WHERE type='external_revocation_required'").get()?.resolved_at).toBeNull();
 }finally{sqlite.close();}
});

it('保留存取權的決定冪等，後續退款重新待審，舊收據重播不清除新審查',async()=>{
 const {db,sqlite,order}=await setup();try{
  await refundOrder(db,order.payment_intent_id!,100);const input=review(order.id,'retain');
  const saved=await reviewOrderRefund(db,'admin',input);expect(await reviewOrderRefund(db,'admin',input)).toEqual(saved);
  expect(await getOrder(db,order.id)).toMatchObject({review_required:0,access_revoked_at:null,refunded_minor:100});
  expect((await deliverOrder(db,secret,order.id,'buyer-owner')).code).toBe('REFUND-REVIEW-CODE');
  await expect(reviewOrderRefund(db,'admin',{...input,decision:'revoke'})).rejects.toThrow('ORDER_REFUND_REVIEW_CONFLICT');
  await refundOrder(db,order.payment_intent_id!,200);
  expect(await reviewOrderRefund(db,'admin',input)).toEqual(saved);
  expect((await getOrder(db,order.id))?.review_required).toBe(1);
  await expect(reviewOrderRefund(db,'admin',review(order.id,'revoke',100))).rejects.toThrow('ORDER_REFUND_REVIEW_CONFLICT');
  await reviewOrderRefund(db,'admin',review(order.id,'retain',200));
  expect(sqlite.prepare('SELECT count(*) n FROM order_refund_reviews').get()?.n).toBe(2);
  const listed=(await listOrders(db,{})).orders[0];expect(listed.access_revoked_at).toBeNull();
  expect(JSON.parse(listed.refund_review_json!)).toMatchObject({refundedMinor:200,decision:'retain',adminId:'admin'});
 }finally{sqlite.close();}
});

it('撤銷獨立碼只回收未消耗額度，審查與權益同時提交',async()=>{
 const {db,sqlite,p,b,order}=await setup();try{
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'credits',bucket:'tokens',amount:100}});
  await redeemCode(db,'owner',{productId:p.id,code:'REFUND-REVIEW-CODE',idempotencyKey:crypto.randomUUID()});
  const wallet=sqlite.prepare('SELECT id FROM credit_wallets').get()!.id as string;
  await applyCreditOperation(db,{walletId:wallet,kind:'spend',amount:60,idempotencyKey:'spend'});
  await refundOrder(db,order.payment_intent_id!,100);
  await reviewOrderRefund(db,'admin',review(order.id,'revoke'));
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('revoked');
  expect((await getOrder(db,order.id))?.access_revoked_at).not.toBeNull();
  expect((await deliverOrder(db,secret,order.id,'buyer-owner')).code).toBeNull();
  expect((await creditHistory(db,wallet)).wallet.balance).toBe(0);
  expect(await creditGrantStatus(db,wallet)).toMatchObject([{reclaimed:40,consumed_outstanding:60}]);
  expect(sqlite.prepare('SELECT count(*) n FROM order_refund_reviews').get()?.n).toBe(1);
 }finally{sqlite.close();}
});

it('共用碼僅撤銷目標訂單與來源權益，不改變其他買家的碼及額度',async()=>{
 const {db,sqlite,p,b,order,sale}=await setup('redemption','shared');try{
  const other=await sale('other');
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'credits',bucket:'tokens',amount:100}});
  for(const user of ['owner','other'])await redeemCode(db,user,{productId:p.id,code:'REFUND-REVIEW-CODE',idempotencyKey:crypto.randomUUID()});
  await refundOrder(db,order.payment_intent_id!,100);await reviewOrderRefund(db,'admin',review(order.id,'revoke'));
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).not.toBe('revoked');
  expect((await getOrder(db,other.id))?.access_revoked_at).toBeNull();
  expect((await deliverOrder(db,secret,other.id,'buyer-other')).code).toBe('REFUND-REVIEW-CODE');
  expect(sqlite.prepare('SELECT balance FROM credit_wallets WHERE user_id=?').get('owner')?.balance).toBe(0);
  expect(sqlite.prepare('SELECT balance FROM credit_wallets WHERE user_id=?').get('other')?.balance).toBe(100);
 }finally{sqlite.close();}
});

it('外部平台碼僅能確認人工處理，不宣稱撤銷外部碼',async()=>{
 const {db,sqlite,order}=await setup('external');try{
  await refundOrder(db,order.payment_intent_id!,500);
  for(const choice of ['revoke','retain'] as const)await expect(reviewOrderRefund(db,'admin',review(order.id,choice,500))).rejects.toThrow('ORDER_REFUND_REVIEW_CONFLICT');
  await reviewOrderRefund(db,'admin',review(order.id,'acknowledge',500));
  expect(await getOrder(db,order.id)).toMatchObject({review_required:0,access_revoked_at:null,status:'refunded'});
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('assigned');
  expect((await deliverOrder(db,secret,order.id,'buyer-owner')).code).toBe('REFUND-REVIEW-CODE');
 }finally{sqlite.close();}
});

it('同額退款的相反決定只能成功一次；下游失敗時審查與撤銷一起回滾',async()=>{
 const {db,sqlite,order}=await setup();try{
  await refundOrder(db,order.payment_intent_id!,100);
  sqlite.exec("CREATE TRIGGER fail_review BEFORE UPDATE OF status ON codes WHEN NEW.status='revoked' BEGIN SELECT RAISE(ABORT,'TEST_RECLAIM_FAILURE'); END;");
  await expect(reviewOrderRefund(db,'admin',review(order.id,'revoke'))).rejects.toThrow('TEST_RECLAIM_FAILURE');
  expect(sqlite.prepare('SELECT count(*) n FROM order_refund_reviews').get()?.n).toBe(0);
  expect(await getOrder(db,order.id)).toMatchObject({review_required:1,access_revoked_at:null});
  sqlite.exec('DROP TRIGGER fail_review');
  const results=await Promise.allSettled(['retain','revoke'].map(decision=>reviewOrderRefund(db,'admin',review(order.id,decision as 'retain'|'revoke'))));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(sqlite.prepare('SELECT count(*) n FROM order_refund_reviews').get()?.n).toBe(1);
 }finally{sqlite.close();}
});

it('未退款、錯誤金額與不存在訂單拒絕；部分退款保留不阻止全額自動撤銷',async()=>{
 const {db,sqlite,order}=await setup();try{
  await expect(reviewOrderRefund(db,'admin',review(order.id,'retain'))).rejects.toThrow('ORDER_REFUND_REVIEW_CONFLICT');
  await expect(reviewOrderRefund(db,'admin',review(crypto.randomUUID(),'retain'))).rejects.toThrow('ORDER_REFUND_REVIEW_CONFLICT');
  await refundOrder(db,order.payment_intent_id!,100);await reviewOrderRefund(db,'admin',review(order.id,'retain'));
  await refundOrder(db,order.payment_intent_id!,500);
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('revoked');
  expect((await deliverOrder(db,secret,order.id,'buyer-owner')).code).toBeNull();
 }finally{sqlite.close();}
});

it('已撤銷的共用訂單可確認審查，但不能選擇保留來恢復權益',async()=>{
 const {db,sqlite,order}=await setup('redemption','shared');try{
  await refundOrder(db,order.payment_intent_id!,500);
  await expect(reviewOrderRefund(db,'admin',review(order.id,'retain',500))).rejects.toThrow('ORDER_REFUND_REVIEW_CONFLICT');
  const before=(await getOrder(db,order.id))?.access_revoked_at;
  await reviewOrderRefund(db,'admin',review(order.id,'acknowledge',500));
  expect(await getOrder(db,order.id)).toMatchObject({review_required:0,access_revoked_at:before});
 }finally{sqlite.close();}
});
