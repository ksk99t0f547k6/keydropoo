import {it,expect} from 'vitest';
import Stripe from 'stripe';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
import {exportStripePromotion,resumeStripeExport} from '../src/lib/server/stripe-inventory-export';
import {stripeDiscountGateway} from '../src/lib/server/stripe-discounts';
import {pullStripeDiscount} from '../src/lib/server/stripe-discount-catalog';
const secret='ab'.repeat(32),scope={accountId:'acct_fixture',livemode:false},now=2000000000000;
async function setup(){
 const database=testDatabase(),{db,sqlite}=database;
 const product=await createProduct(db,{name:'Export',slug:'export'});
 const batch=await createBatch(db,secret,{productId:product.id,name:'Existing discount',kind:'discount',source:'manual',codes:['LOCAL-CODE']});
 const code=sqlite.prepare('SELECT id FROM codes').get() as {id:string};
 sqlite.prepare('UPDATE codes SET expires_at=?').run(now+3600000);
 const coupon={id:'coupon_fixture',object:'coupon',livemode:false,valid:true,name:null,amount_off:null,percent_off:25,currency:null,duration:'once',duration_in_months:null,max_redemptions:null,times_redeemed:0,redeem_by:null as number|null};
 const promotion={id:'promo_exported',object:'promotion_code',livemode:false,active:true,code:'LOCAL-CODE',promotion:{type:'coupon',coupon:coupon.id},customer:null,customer_account:null,expires_at:null as number|null,max_redemptions:null,times_redeemed:0,restrictions:{first_time_transaction:false,minimum_amount:null,minimum_amount_currency:null}};
 const state={calls:0,failCreate:false,failPull:false,keys:[] as string[]};
 const gateway=stripeDiscountGateway(new Stripe('sk_test_fixture',{maxNetworkRetries:0,httpClient:Stripe.createFetchHttpClient(async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(init?.method==='POST'){
   state.calls++;state.keys.push(new Headers(init.headers).get('idempotency-key')!);
   if(state.failCreate)return Response.json({error:{type:'api_error',message:'private'}},{status:500});
   const data=new URLSearchParams(String(init.body));promotion.expires_at=Number(data.get('expires_at'));return Response.json(promotion);
  }
  if(path.includes('/coupons/'))return Response.json(coupon);
  if(state.failPull)return Response.json({error:{type:'api_error',message:'private'}},{status:500});
  return Response.json(promotion);
 })}));
 return {...database,product,batch,code,coupon,promotion,state,gateway,input:{productId:product.id,codeId:code.id,operationId:crypto.randomUUID(),promotion:{couponId:coupon.id}}};
}
it('既有碼推送沿用原批次與加密碼，來源同步可停發且不延長本機期限',async()=>{
 const {db,sqlite,input,batch,code,coupon,promotion,state,gateway}=await setup();try{
  const first=await exportStripePromotion(db,secret,gateway,scope,input,now);
  expect(first).toMatchObject({linked:true,batchId:batch.id,codeId:code.id,sourceId:promotion.id});
  expect(await exportStripePromotion(db,secret,gateway,scope,input,now+100)).toEqual(first);expect(state.calls).toBe(1);
  expect(sqlite.prepare('SELECT count(*) n FROM codes').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT source FROM code_batches').get()?.source).toBe('manual');
  expect(sqlite.prepare('SELECT expires_at FROM codes').get()?.expires_at).toBe(now+3600000);
  coupon.redeem_by=Math.floor((now+600000)/1000);
  await pullStripeDiscount(db,secret,gateway,{...scope,kind:'coupon',sourceId:coupon.id},now+200);
  expect(sqlite.prepare('SELECT expires_at FROM codes').get()?.expires_at).toBe(now+600000);
  coupon.redeem_by=null;
  await pullStripeDiscount(db,secret,gateway,{...scope,kind:'coupon',sourceId:coupon.id},now+300);
  expect(sqlite.prepare('SELECT expires_at FROM codes').get()?.expires_at).toBe(now+3600000);
  promotion.active=false;
  await pullStripeDiscount(db,secret,gateway,{...scope,kind:'promotion_code',sourceId:promotion.id},now+400);
  expect(sqlite.prepare('SELECT code_id FROM stripe_unavailable_codes').get()?.code_id).toBe(code.id);
 }finally{sqlite.close();}
});
it('推送失敗保留固定操作與庫存鎖，重試不換鍵，拒絕不同操作或設定',async()=>{
 const {db,sqlite,input,code,state,gateway}=await setup();try{
  state.failCreate=true;
  await expect(exportStripePromotion(db,secret,gateway,scope,input,now)).rejects.toThrow('STRIPE_OPERATION_FAILED');
  expect(sqlite.prepare('SELECT code_id FROM stripe_unavailable_codes').get()?.code_id).toBe(code.id);
  await expect(exportStripePromotion(db,secret,gateway,scope,{...input,operationId:crypto.randomUUID()},now+100)).rejects.toThrow('STRIPE_INVENTORY_CONFLICT');
  await expect(exportStripePromotion(db,secret,gateway,scope,{...input,promotion:{...input.promotion,maxRedemptions:2}},now+100)).rejects.toThrow('STRIPE_INVENTORY_CONFLICT');
  state.failCreate=false;
  expect(await resumeStripeExport(db,secret,gateway,scope,input.productId,input.codeId)).toMatchObject({linked:true});
  expect(new Set(state.keys).size).toBe(1);
  expect(sqlite.prepare('SELECT count(*) n FROM stripe_unavailable_codes').get()?.n).toBe(0);
 }finally{sqlite.close();}
});
it('Stripe 建立成功但同步失敗回已建立未關聯，重試只補關聯',async()=>{
 const {db,sqlite,input,state,gateway}=await setup();try{
  state.failPull=true;
  expect(await exportStripePromotion(db,secret,gateway,scope,input,now)).toMatchObject({linked:false,sourceId:'promo_exported'});
  state.failPull=false;
  expect(await exportStripePromotion(db,secret,gateway,scope,input,now+100)).toMatchObject({linked:true});expect(state.calls).toBe(1);
 }finally{sqlite.close();}
});
it('未知建立超過安全期限保留人工待查，不再建立或解除分發鎖',async()=>{
 const {db,sqlite,input,code,state,gateway}=await setup();try{
  state.failCreate=true;
  await expect(exportStripePromotion(db,secret,gateway,scope,input,now)).rejects.toThrow('STRIPE_OPERATION_FAILED');
  state.failCreate=false;
  await expect(exportStripePromotion(db,secret,gateway,scope,input,now+24*3600000)).rejects.toThrow('STRIPE_OPERATION_REVIEW_REQUIRED');
  expect(state.calls).toBe(1);
  expect(sqlite.prepare('SELECT code_id FROM stripe_unavailable_codes').get()?.code_id).toBe(code.id);
  expect(sqlite.prepare('SELECT state FROM stripe_discount_operations').get()?.state).toBe('review');
  const row=sqlite.prepare('SELECT request_ciphertext FROM stripe_inventory_exports').get();
  expect(row?.request_ciphertext).not.toContain('coupon_fixture');
 }finally{sqlite.close();}
});
