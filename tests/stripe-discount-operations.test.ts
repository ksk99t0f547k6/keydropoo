import {it,expect,vi} from 'vitest';
import {testDatabase} from './d1';
import {createStripeDiscount} from '../src/lib/server/stripe-discount-operations';
import type {StripeCouponSnapshot,StripePromotionSnapshot} from '../src/lib/server/stripe-discounts';
const secret='ab'.repeat(32),scope={accountId:'acct_fixture',livemode:false};
const input={kind:'promotion_code',input:{couponId:'coupon_fixture',code:'PRIVATE-CREATE-CODE'}};
const promotion:StripePromotionSnapshot={id:'promo_fixture',object:'promotion_code',livemode:false,active:true,code:'PRIVATE-CREATE-CODE',promotion:{type:'coupon',coupon:'coupon_fixture'},customer:null,customer_account:null,expires_at:null,max_redemptions:null,times_redeemed:0,restrictions:{first_time_transaction:false,minimum_amount:null,minimum_amount_currency:null}};
function gateway(){return {createPromotion:vi.fn<(id:string,input:unknown)=>Promise<StripePromotionSnapshot>>(async()=>promotion),createCoupon:vi.fn<(id:string,input:unknown)=>Promise<StripeCouponSnapshot>>()};}
it('建立意圖先加密持久化；失敗重試固定 ID／本文，完成後永久重播不再建立',async()=>{
 const {db,sqlite}=testDatabase();try{
  const id=crypto.randomUUID(),api=gateway(),now=Date.now();
  api.createPromotion.mockImplementationOnce(async()=>{
   const record=sqlite.prepare('SELECT * FROM stripe_discount_operations').get();expect(record?.state).toBe('sending');expect(JSON.stringify(record)).not.toContain('PRIVATE-CREATE-CODE');
   throw new Error('private Stripe response');
  });
  await expect(createStripeDiscount(db,secret,api,scope,id,input,now)).rejects.toThrow('STRIPE_OPERATION_FAILED');
  expect(sqlite.prepare('SELECT state FROM stripe_discount_operations').get()?.state).toBe('retryable');
  const result=await createStripeDiscount(db,secret,api,scope,id,input,now+1000);
  expect(api.createPromotion.mock.calls[1]).toEqual(api.createPromotion.mock.calls[0]);
  expect(await createStripeDiscount(db,secret,api,scope,id,input,now+48*3600000)).toEqual(result);expect(api.createPromotion).toHaveBeenCalledTimes(2);
 }finally{sqlite.close();}
});
it('同操作 ID 不可換內容、帳戶或模式；百分比／金額規則先驗證',async()=>{
 const {db,sqlite}=testDatabase();try{
  const id=crypto.randomUUID(),api=gateway();await createStripeDiscount(db,secret,api,scope,id,input);
  for(const [otherScope,otherInput] of [[{...scope,livemode:true},input],[{...scope,accountId:'acct_other'},input],[scope,{...input,input:{...input.input,code:'DIFFERENT'}}]] as const){
   await expect(createStripeDiscount(db,secret,api,otherScope,id,otherInput)).rejects.toThrow('STRIPE_OPERATION_CONFLICT');
  }
  await expect(createStripeDiscount(db,secret,api,scope,crypto.randomUUID(),{kind:'coupon',input:{discount:{kind:'percent',percentOff:0}}})).rejects.toThrow();
  expect(api.createPromotion).toHaveBeenCalledTimes(1);expect(api.createCoupon).not.toHaveBeenCalled();
 }finally{sqlite.close();}
});
it('超過 23 小時的不明建立結果轉人工核對，不重新送出',async()=>{
 const {db,sqlite}=testDatabase();try{
  const id=crypto.randomUUID(),api=gateway(),now=Date.now();api.createPromotion.mockRejectedValue(new Error('timeout'));
  await expect(createStripeDiscount(db,secret,api,scope,id,input,now)).rejects.toThrow('STRIPE_OPERATION_FAILED');
  await expect(createStripeDiscount(db,secret,api,scope,id,input,now+23*3600000)).rejects.toThrow('STRIPE_OPERATION_REVIEW_REQUIRED');
  await expect(createStripeDiscount(db,secret,api,scope,id,input,now+48*3600000)).rejects.toThrow('STRIPE_OPERATION_REVIEW_REQUIRED');
  expect(api.createPromotion).toHaveBeenCalledTimes(1);expect(sqlite.prepare('SELECT state FROM stripe_discount_operations').get()?.state).toBe('review');
 }finally{sqlite.close();}
});
it('建立租約避免並行重送，過期接手後舊結果不能改寫識別',async()=>{
 const {db,sqlite}=testDatabase();try{
  const id=crypto.randomUUID(),api=gateway(),now=Date.now();let release:(value:StripePromotionSnapshot)=>void=()=>{},start:()=>void=()=>{};
  const began=new Promise<void>(resolve=>{start=resolve;});api.createPromotion.mockImplementationOnce(async()=>{start();return new Promise(resolve=>{release=resolve;});});
  const pending=createStripeDiscount(db,secret,api,scope,id,input,now);await began;
  await expect(createStripeDiscount(db,secret,api,scope,id,input,now)).rejects.toThrow('STRIPE_OPERATION_BUSY');
  expect(await createStripeDiscount(db,secret,api,scope,id,input,now+60001)).toMatchObject({sourceId:'promo_fixture'});
  const outcome=expect(pending).rejects.toThrow('STRIPE_OPERATION_FAILED');release({...promotion,id:'promo_old'});await outcome;
  expect(sqlite.prepare('SELECT state,source_id FROM stripe_discount_operations').get()).toEqual({state:'applied',source_id:'promo_fixture'});
 }finally{sqlite.close();}
});
it('Coupon 使用固定識別，貨幣選項順序不影響冪等；錯誤模式不能記為成功',async()=>{
 const {db,sqlite}=testDatabase();try{
  const id=crypto.randomUUID(),api=gateway();
  const coupon:StripeCouponSnapshot={id:`kd_${id.replaceAll('-','')}`,object:'coupon',livemode:false,valid:true,name:null,amount_off:500,percent_off:null,currency:'usd',duration:'once',duration_in_months:null,max_redemptions:null,times_redeemed:0,redeem_by:null,currency_options:{jpy:{amount_off:100},eur:{amount_off:300}}};
  api.createCoupon.mockResolvedValue(coupon);
  const a={kind:'coupon',input:{discount:{kind:'amount',amountOff:500,currency:'usd',currencyOptions:{jpy:100,eur:300}}}};
  const b={kind:'coupon',input:{discount:{kind:'amount',amountOff:500,currency:'usd',currencyOptions:{eur:300,jpy:100}}}};
  const result=await createStripeDiscount(db,secret,api,scope,id,a);
  expect(await createStripeDiscount(db,secret,api,scope,id,b)).toEqual(result);expect(api.createCoupon).toHaveBeenCalledTimes(1);
  api.createPromotion.mockResolvedValue({...promotion,livemode:true});
  const wrong=crypto.randomUUID();await expect(createStripeDiscount(db,secret,api,scope,wrong,input)).rejects.toThrow('STRIPE_OPERATION_FAILED');
  expect(sqlite.prepare('SELECT state,source_id FROM stripe_discount_operations WHERE id=?').get(wrong)).toEqual({state:'retryable',source_id:null});
 }finally{sqlite.close();}
});
