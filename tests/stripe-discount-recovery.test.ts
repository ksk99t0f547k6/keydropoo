import {it,expect,vi} from 'vitest';
import {testDatabase} from './d1';
import {createStripeDiscount,resumeStripeDiscount,recoverStripeDiscount,listStripeDiscountOperations} from '../src/lib/server/stripe-discount-operations';
import type {StripeCouponSnapshot,StripePromotionSnapshot} from '../src/lib/server/stripe-discounts';
const secret='ab'.repeat(32),scope={accountId:'acct_fixture',livemode:false},input={kind:'promotion_code',input:{couponId:'coupon_fixture',code:'PRIVATE-CODE'}};
const promotion:StripePromotionSnapshot={id:'promo_fixture',object:'promotion_code',livemode:false,active:true,code:'PRIVATE-CODE',promotion:{type:'coupon',coupon:'coupon_fixture'},customer:null,customer_account:null,expires_at:null,max_redemptions:null,times_redeemed:0,restrictions:{first_time_transaction:false,minimum_amount:null,minimum_amount_currency:null}};
function gateway(id:string){return {createPromotion:vi.fn<(id:string,input:unknown)=>Promise<StripePromotionSnapshot>>(async()=>{throw new Error('timeout');}),createCoupon:vi.fn<(id:string,input:unknown)=>Promise<StripeCouponSnapshot>>(),recoveryPromotion:vi.fn(async()=>({snapshot:promotion,operationId:id as string|null})),recoveryCoupon:vi.fn<()=>Promise<{snapshot:StripeCouponSnapshot;operationId:string|null}>>()};}
it('超時建立可只讀復原，完成後重播；列表不含加密本文或碼',async()=>{
 const {db,sqlite}=testDatabase();try{
  const id=crypto.randomUUID(),api=gateway(id),now=Date.now();
  await expect(createStripeDiscount(db,secret,api,scope,id,input,now)).rejects.toThrow('STRIPE_OPERATION_FAILED');
  const list=await listStripeDiscountOperations(db,scope);expect(list.items[0].id).toBe(id);expect(JSON.stringify(list)).not.toContain('PRIVATE-CODE');
  const result=await recoverStripeDiscount(db,secret,api,scope,id,promotion.id,now+48*3600000);
  expect(result).toEqual({operationId:id,sourceId:promotion.id});expect(api.createPromotion).toHaveBeenCalledTimes(1);expect(api.recoveryPromotion).toHaveBeenCalledTimes(1);
  expect(await resumeStripeDiscount(db,secret,api,scope,id)).toEqual(result);expect(api.createPromotion).toHaveBeenCalledTimes(1);
  await expect(recoverStripeDiscount(db,secret,api,scope,id,'promo_other')).rejects.toThrow('STRIPE_OPERATION_CONFLICT');
 }finally{sqlite.close();}
});
it('從持久化原請求恢復重試，不需要瀏覽器保留表單內容',async()=>{
 const {db,sqlite}=testDatabase();try{
  const id=crypto.randomUUID(),api=gateway(id);
  await expect(createStripeDiscount(db,secret,api,scope,id,input)).rejects.toThrow();api.createPromotion.mockResolvedValue(promotion);
  await resumeStripeDiscount(db,secret,api,scope,id);
  expect(api.createPromotion.mock.calls[1]).toEqual(api.createPromotion.mock.calls[0]);
  await expect(resumeStripeDiscount(db,secret,api,{...scope,accountId:'acct_other'},id)).rejects.toThrow('STRIPE_OPERATION_NOT_FOUND');
 }finally{sqlite.close();}
});
it('錯誤 metadata、帳戶模式、Coupon 關聯與原始碼都不能關聯到失敗操作',async()=>{
 for(const mismatch of [ {operationId:null}, {operationId:crypto.randomUUID()}, {snapshot:{...promotion,livemode:true}}, {snapshot:{...promotion,code:'OTHER'}}, {snapshot:{...promotion,promotion:{type:'coupon' as const,coupon:'other'}}}]){
  const {db,sqlite}=testDatabase();try{
   const id=crypto.randomUUID(),api=gateway(id),now=Date.now();await expect(createStripeDiscount(db,secret,api,scope,id,input,now)).rejects.toThrow();
   api.recoveryPromotion.mockResolvedValue({snapshot:promotion,operationId:id,...mismatch});
   await expect(recoverStripeDiscount(db,secret,api,scope,id,promotion.id,now+48*3600000)).rejects.toThrow('STRIPE_OPERATION_RECOVERY_FAILED');
   expect(sqlite.prepare('SELECT state,source_id FROM stripe_discount_operations').get()).toEqual({state:'review',source_id:null});expect(api.createPromotion).toHaveBeenCalledTimes(1);
  }finally{sqlite.close();}
 }
});
it('仍在途建立不可復原；租約換人後晚到的復原結果不能覆寫',async()=>{
 const {db,sqlite}=testDatabase();try{
  const id=crypto.randomUUID(),api=gateway(id),now=Date.now();await expect(createStripeDiscount(db,secret,api,scope,id,input,now)).rejects.toThrow();
  sqlite.prepare("UPDATE stripe_discount_operations SET state='sending',lease_until=?,lease_token='existing'").run(now+60000);
  await expect(recoverStripeDiscount(db,secret,api,scope,id,promotion.id,now)).rejects.toThrow('STRIPE_OPERATION_BUSY');expect(api.recoveryPromotion).not.toHaveBeenCalled();
  api.recoveryPromotion.mockImplementationOnce(async()=>{sqlite.prepare("UPDATE stripe_discount_operations SET lease_token='new-owner'").run();return {snapshot:promotion,operationId:id};});
  await expect(recoverStripeDiscount(db,secret,api,scope,id,promotion.id,now+60001)).rejects.toThrow('STRIPE_OPERATION_RECOVERY_FAILED');
  expect(sqlite.prepare('SELECT state,source_id,lease_token FROM stripe_discount_operations').get()).toEqual({state:'sending',source_id:null,lease_token:'new-owner'});
 }finally{sqlite.close();}
});
it('Coupon 復原必須使用原操作衍生 ID 與 metadata，不能指定任意既有 Coupon',async()=>{
 const {db,sqlite}=testDatabase();try{
  const id=crypto.randomUUID(),api=gateway(id),sourceId=`kd_${id.replaceAll('-','')}`;
  api.createCoupon.mockRejectedValue(new Error('timeout'));
  await expect(createStripeDiscount(db,secret,api,scope,id,{kind:'coupon',input:{discount:{kind:'percent',percentOff:25}}})).rejects.toThrow();
  await expect(recoverStripeDiscount(db,secret,api,scope,id,'coupon_other')).rejects.toThrow('STRIPE_OPERATION_RECOVERY_MISMATCH');expect(api.recoveryCoupon).not.toHaveBeenCalled();
  api.recoveryCoupon.mockResolvedValue({operationId:id,snapshot:{id:sourceId,object:'coupon',livemode:false,valid:true,name:null,amount_off:null,percent_off:25,currency:null,duration:'once',duration_in_months:null,max_redemptions:null,times_redeemed:0,redeem_by:null}});
  expect(await recoverStripeDiscount(db,secret,api,scope,id,sourceId)).toEqual({operationId:id,sourceId});expect(api.createCoupon).toHaveBeenCalledTimes(1);
 }finally{sqlite.close();}
});
