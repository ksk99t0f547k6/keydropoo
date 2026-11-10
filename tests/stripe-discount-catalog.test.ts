import {it,expect,vi} from 'vitest';
import {testDatabase} from './d1';
import {pullStripeDiscount,readStripeDiscount,listStripeDiscounts} from '../src/lib/server/stripe-discount-catalog';
import {StripeDiscountMissingError,type StripeCouponSnapshot,type StripePromotionSnapshot} from '../src/lib/server/stripe-discounts';
const secret='ab'.repeat(32),key={accountId:'acct_fixture',livemode:false,kind:'promotion_code',sourceId:'promo_fixture'};
const promotion:StripePromotionSnapshot={id:'promo_fixture',object:'promotion_code',livemode:false,active:true,code:'PRIVATE-PROMO-CODE',promotion:{type:'coupon',coupon:'coupon_fixture'},customer:'cus_fixture',customer_account:null,expires_at:null,max_redemptions:10,times_redeemed:2,restrictions:{first_time_transaction:true,minimum_amount:1000,minimum_amount_currency:'usd'}};
function gateway(){return {retrievePromotion:vi.fn<(id:string)=>Promise<StripePromotionSnapshot>>(async()=>promotion),retrieveCoupon:vi.fn<(id:string)=>Promise<StripeCouponSnapshot>>()};}
it('匯入以 Stripe 為準覆寫有效狀態和次數；碼與客戶限制僅加密保存',async()=>{
 const {db,sqlite}=testDatabase();try{
  const api=gateway();await pullStripeDiscount(db,secret,api,key);
  const row=sqlite.prepare('SELECT * FROM stripe_discount_catalog').get();expect(JSON.stringify(row)).not.toContain(promotion.code);expect(JSON.stringify(row)).not.toContain('cus_fixture');
  expect((await readStripeDiscount(db,secret,key))?.snapshot).toEqual(promotion);
  api.retrievePromotion.mockResolvedValue({...promotion,active:false,times_redeemed:10});await pullStripeDiscount(db,secret,api,key);
  expect(await readStripeDiscount(db,secret,key)).toMatchObject({version:2,fresh:true,snapshot:{active:false,times_redeemed:10}});
  const list=await listStripeDiscounts(db,{accountId:key.accountId,livemode:false,kind:key.kind});expect(list.items).toHaveLength(1);expect(JSON.stringify(list)).not.toContain(promotion.code);
 }finally{sqlite.close();}
});
it('帳戶與模式隔離；錯誤模式失敗且不能把舊資料當作同步完成',async()=>{
 const {db,sqlite}=testDatabase();try{
  const api=gateway();await pullStripeDiscount(db,secret,api,key);
  await pullStripeDiscount(db,secret,api,{...key,accountId:'acct_other'});
  await expect(pullStripeDiscount(db,secret,api,{...key,livemode:true})).rejects.toThrow('STRIPE_SYNC_FAILED');
  expect(await readStripeDiscount(db,secret,{...key,livemode:true})).toMatchObject({snapshot:null,fresh:false,error:'STRIPE_SYNC_FAILED'});
  expect((await readStripeDiscount(db,secret,key))?.fresh).toBe(true);
  const other=sqlite.prepare("SELECT ciphertext FROM stripe_discount_catalog WHERE account_id='acct_other'").get()!;
  sqlite.prepare("UPDATE stripe_discount_catalog SET ciphertext=? WHERE account_id='acct_fixture' AND livemode=0").run(other.ciphertext);
  await expect(readStripeDiscount(db,secret,key)).rejects.toThrow();
 }finally{sqlite.close();}
});
it('後啟動同步先完成時，晚到的舊結果不能覆寫或清除錯誤',async()=>{
 const {db,sqlite}=testDatabase();try{
  const api=gateway();let release:(value:StripePromotionSnapshot)=>void=()=>{};let started:()=>void=()=>{};
  const began=new Promise<void>(resolve=>{started=resolve;});
  api.retrievePromotion.mockImplementationOnce(async()=>{started();return new Promise(resolve=>{release=resolve;});});
  const old=pullStripeDiscount(db,secret,api,key);await began;
  api.retrievePromotion.mockResolvedValue({...promotion,active:false,times_redeemed:9});await pullStripeDiscount(db,secret,api,key);
  release(promotion);expect(await old).toMatchObject({stored:false});
  expect(await readStripeDiscount(db,secret,key)).toMatchObject({version:2,fresh:true,snapshot:{times_redeemed:9,active:false}});
 }finally{sqlite.close();}
});
it('同步失敗保留舊快照但標記過時；只有明確不存在才寫入刪除狀態',async()=>{
 const {db,sqlite}=testDatabase();try{
  const api=gateway();await pullStripeDiscount(db,secret,api,key);
  api.retrievePromotion.mockRejectedValueOnce(new Error('secret private Stripe error'));
  await expect(pullStripeDiscount(db,secret,api,key)).rejects.toThrow('STRIPE_SYNC_FAILED');
  expect(await readStripeDiscount(db,secret,key)).toMatchObject({fresh:false,deleted:false,snapshot:promotion,error:'STRIPE_SYNC_FAILED'});
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM stripe_discount_catalog').get())).not.toContain('private');
  api.retrievePromotion.mockRejectedValueOnce(new StripeDiscountMissingError());await pullStripeDiscount(db,secret,api,key);
  expect(await readStripeDiscount(db,secret,key)).toMatchObject({fresh:true,deleted:true,snapshot:null,error:null});
  api.retrievePromotion.mockResolvedValue(promotion);await pullStripeDiscount(db,secret,api,key);
  expect(await readStripeDiscount(db,secret,key)).toMatchObject({fresh:true,deleted:false,snapshot:promotion});
 }finally{sqlite.close();}
});
