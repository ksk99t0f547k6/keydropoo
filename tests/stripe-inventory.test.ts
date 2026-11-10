import {it,expect,vi} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch,changeCodeStatus,listCodes} from '../src/lib/server/inventory';
import {createCampaign,setCampaignStatus} from '../src/lib/server/campaigns';
import {claimCode} from '../src/lib/server/claims';
import {reserveOrder,attachCheckout,settleOrder} from '../src/lib/server/orders';
import {restockBatch} from '../src/lib/server/restock';
import {pullStripeDiscount} from '../src/lib/server/stripe-discount-catalog';
import {importStripePromotion} from '../src/lib/server/stripe-inventory';
import {StripeDiscountMissingError,type StripeCouponSnapshot,type StripePromotionSnapshot} from '../src/lib/server/stripe-discounts';
const secret='ab'.repeat(32),scope={accountId:'acct_fixture',livemode:false};
const coupon:StripeCouponSnapshot={id:'coupon_fixture',object:'coupon',livemode:false,valid:true,name:null,amount_off:null,percent_off:25,currency:null,duration:'once',duration_in_months:null,max_redemptions:null,times_redeemed:0,redeem_by:null};
const promotion:StripePromotionSnapshot={id:'promo_fixture',object:'promotion_code',livemode:false,active:true,code:'STRIPE-INVENTORY',promotion:{type:'coupon',coupon:coupon.id},customer:null,customer_account:null,expires_at:null,max_redemptions:null,times_redeemed:0,restrictions:{first_time_transaction:false,minimum_amount:null,minimum_amount_currency:null}};
async function setup(){
 const database=testDatabase(),{db}=database;
 const product=await createProduct(db,{name:'Stripe codes',slug:'stripe-codes',priceMinor:500});
 const api={retrieveCoupon:vi.fn(async()=>coupon),retrievePromotion:vi.fn(async()=>promotion)};
 const syncCoupon=()=>pullStripeDiscount(db,secret,api,{...scope,kind:'coupon',sourceId:coupon.id});
 const syncPromotion=()=>pullStripeDiscount(db,secret,api,{...scope,kind:'promotion_code',sourceId:promotion.id});
 await syncCoupon();await syncPromotion();
 const input={productId:product.id,promotionId:promotion.id,name:'Imported Stripe code',distributionMode:'shared',sharedClaimLimit:10};
 const imported=await importStripePromotion(db,secret,scope,input);
 const campaign=await createCampaign(db,{productId:product.id,batchId:imported.batchId,name:'Free',slug:'free',conditions:{type:'always'}});await setCampaignStatus(db,campaign.id,1,'active');
 const claim=(userId:string,key=crypto.randomUUID())=>claimCode(db,{campaignId:campaign.id,idempotencyKey:key},{userId,emailVerified:false},{encryptionSecret:secret,identitySecret:'fixture-identity-at-least-32-characters',purchasedCount:async()=>0,qualify:async()=>({allowed:false})});
 const reserve=()=>reserveOrder(db,{productId:product.id,batchId:imported.batchId,buyerKey:'buyer',idempotencyKey:crypto.randomUUID()});
 return {...database,api,input,imported,product,syncCoupon,syncPromotion,claim,reserve};
}
it('匯入建立加密碼與來源關聯，重試不重複；普通補貨不能混入無來源碼',async()=>{
 const {db,sqlite,input,imported,claim,product}=await setup();try{
  expect(await importStripePromotion(db,secret,scope,input)).toEqual(imported);
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT ciphertext FROM codes').get()?.ciphertext).not.toContain(promotion.code);
  expect(await claim('owner')).toMatchObject({code:promotion.code});
  await expect(importStripePromotion(db,secret,scope,{...input,distributionMode:'unique'})).rejects.toThrow('STRIPE_INVENTORY_CONFLICT');
  await expect(restockBatch(db,secret,{productId:product.id,batchId:imported.batchId,idempotencyKey:crypto.randomUUID(),codes:['UNLINKED']})).rejects.toThrow('STOCK_SOURCE_UNAVAILABLE');
 }finally{sqlite.close();}
});
it('停用或失敗同步停止新領取與購買，保留既有交付；恢復來源不復活管理員撤銷',async()=>{
 const {db,sqlite,api,claim,reserve,syncPromotion,imported,product}=await setup();try{
  const key=crypto.randomUUID();const first=await claim('first',key);
  api.retrievePromotion.mockResolvedValue({...promotion,active:false});await syncPromotion();
  await expect(claim('second')).rejects.toThrow('CLAIM_UNAVAILABLE');await expect(reserve()).rejects.toThrow('ORDER_STOCK_UNAVAILABLE');
  expect(await claim('first',key)).toEqual(first);
  expect((await listCodes(db,{productId:product.id})).codes[0].source_unavailable).toBe(1);
  api.retrievePromotion.mockResolvedValue(promotion);await syncPromotion();await claim('second');
  api.retrievePromotion.mockRejectedValueOnce(new Error('offline'));await expect(syncPromotion()).rejects.toThrow('STRIPE_SYNC_FAILED');await expect(claim('third')).rejects.toThrow('CLAIM_UNAVAILABLE');
  await changeCodeStatus(db,{productId:product.id,ids:[imported.codeId],action:'revoke'});await syncPromotion();
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('revoked');await expect(claim('third')).rejects.toThrow('CLAIM_UNAVAILABLE');
 }finally{sqlite.close();}
});
it('Coupon 刪除影響其促銷碼；期限取較早值，來源內容變動不錯配舊碼',async()=>{
 const {sqlite,api,claim,syncCoupon,syncPromotion}=await setup();try{
  const later=Math.floor(Date.now()/1000)+3600,earlier=later-600;
  api.retrieveCoupon.mockResolvedValue({...coupon,redeem_by:earlier});await syncCoupon();api.retrievePromotion.mockResolvedValue({...promotion,expires_at:later});await syncPromotion();
  expect(sqlite.prepare('SELECT expires_at FROM codes').get()?.expires_at).toBe(earlier*1000);
  api.retrieveCoupon.mockRejectedValueOnce(new StripeDiscountMissingError());await syncCoupon();await expect(claim('a')).rejects.toThrow('CLAIM_UNAVAILABLE');
  await syncCoupon();api.retrievePromotion.mockResolvedValue({...promotion,code:'CHANGED'});await syncPromotion();await expect(claim('a')).rejects.toThrow('CLAIM_UNAVAILABLE');
 }finally{sqlite.close();}
});
it('付款前來源失效不交付，沿用缺貨退款策略',async()=>{
 const {db,sqlite,api,reserve,syncPromotion}=await setup();try{
  const order=await reserve();await attachCheckout(db,order.id,'cs_fixture');api.retrievePromotion.mockResolvedValue({...promotion,active:false});await syncPromotion();
  const result=await settleOrder(db,{orderId:order.id,sessionId:'cs_fixture',paymentIntentId:'pi_fixture',amountMinor:500,currency:'USD'});
  expect(result.status).toBe('refund_pending');expect(result.code_id).toBeNull();
 }finally{sqlite.close();}
});
it('既有同文字碼不默默綁定，過時快照／已封存商品匯入整筆回滾',async()=>{
 const {db,sqlite,input,product}=await setup();try{
  const other=await createProduct(db,{name:'Other',slug:'other'});
  await createBatch(db,secret,{productId:other.id,name:'Existing',kind:'discount',source:'manual',codes:[promotion.code]});
  await expect(importStripePromotion(db,secret,scope,{...input,productId:other.id})).rejects.toThrow();
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(2);
  const archived=await createProduct(db,{name:'Archived',slug:'archived'});sqlite.prepare('UPDATE products SET archived_at=? WHERE id=?').run(Date.now(),archived.id);
  await expect(importStripePromotion(db,secret,scope,{...input,productId:archived.id})).rejects.toThrow('STRIPE_INVENTORY_UNAVAILABLE');
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(2);
  expect(product.id).not.toBe(other.id);
 }finally{sqlite.close();}
});
it('讀取後同步版本改變時，匯入交易不能落入過時來源；資料庫守衛阻止直接領取',async()=>{
 const {db,sqlite,input,claim,api,syncPromotion}=await setup();try{
  const other=await createProduct(db,{name:'Race',slug:'race'});
  const racing={...db,batch:async(statements:D1PreparedStatement[])=>{sqlite.prepare("UPDATE stripe_discount_catalog SET request_version=request_version+1 WHERE kind='promotion_code'").run();return db.batch(statements);}} as D1Database;
  await expect(importStripePromotion(racing,secret,scope,{...input,productId:other.id})).rejects.toThrow('STRIPE_INVENTORY_UNAVAILABLE');
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(1);
  await syncPromotion();await claim('original');api.retrievePromotion.mockResolvedValue({...promotion,active:false});await syncPromotion();
  expect(()=>sqlite.prepare(`INSERT INTO claims(id,campaign_id,campaign_version,code_id,subject_key,user_id,idempotency_key,created_at)
 SELECT ?,campaign_id,campaign_version,code_id,'new-subject','other',?,created_at FROM claims LIMIT 1`).run(crypto.randomUUID(),crypto.randomUUID())).toThrow('CLAIM_UNAVAILABLE');
 }finally{sqlite.close();}
});
