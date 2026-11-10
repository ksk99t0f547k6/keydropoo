import {it,expect,vi} from 'vitest';
import Stripe from 'stripe';
import {connectStripeDiscounts,executeDiscountAction} from '../src/lib/server/stripe-discount-service';
import {testDatabase} from './d1';
const secret='ab'.repeat(32);
const coupon={id:'coupon_fixture',object:'coupon',livemode:false,valid:true,name:'Fixture',amount_off:null,percent_off:25,currency:null,duration:'once',duration_in_months:null,max_redemptions:null,times_redeemed:0,redeem_by:null};
function client(handler:(url:URL,init?:RequestInit)=>Response){
 const fetcher=vi.fn<typeof fetch>(async(url,init)=>handler(new URL(String(url)),init));
 return {client:new Stripe('sk_test_fixture',{httpClient:Stripe.createFetchHttpClient(fetcher),maxNetworkRetries:0}),fetcher};
}
function identity(url:URL){if(url.pathname==='/v1/account')return Response.json({object:'account',id:'acct_fixture',email:'private@example.test'});if(url.pathname==='/v1/balance')return Response.json({object:'balance',livemode:false,available:[{amount:123456,currency:'usd'}]});return null;}
it('以同一憑證取得帳戶及模式，只回傳必要識別，不回傳餘額或個資',async()=>{
 const fixture=client(url=>identity(url)??new Response('',{status:404}));
 const connection=await connectStripeDiscounts('sk_fixture',fixture.client);
 expect(connection.scope).toEqual({accountId:'acct_fixture',livemode:false});expect(fixture.fetcher).toHaveBeenCalledTimes(2);
 await expect(connectStripeDiscounts(undefined,fixture.client)).rejects.toThrow('STRIPE_NOT_CONFIGURED');
 const bad=client(()=>Response.json({object:'balance',livemode:'false'}));await expect(connectStripeDiscounts('sk_fixture',bad.client)).rejects.toThrow('STRIPE_IDENTITY_UNAVAILABLE');
});
it('探索不洩漏原始碼；同步範圍由連線決定，不能自行指定另一帳戶',async()=>{
 const {db,sqlite}=testDatabase();try{
  const fixture=client(url=>identity(url)??Response.json({object:'list',has_more:false,data:[coupon]}));const connection=await connectStripeDiscounts('sk_fixture',fixture.client);
  expect(await executeDiscountAction(db,secret,connection,{action:'discover',kind:'coupon'})).toEqual({scope:connection.scope,items:[{sourceId:coupon.id,active:true}],nextCursor:null});
  const count=fixture.fetcher.mock.calls.length;
  await expect(executeDiscountAction(db,secret,connection,{action:'sync',kind:'coupon',sourceId:coupon.id,expectedScope:{...connection.scope,livemode:true}})).rejects.toThrow('STRIPE_CONNECTION_CHANGED');
  await expect(executeDiscountAction(db,secret,connection,{action:'catalog',kind:'coupon',accountId:'acct_other'})).rejects.toThrow();
  expect(fixture.fetcher).toHaveBeenCalledTimes(count);
 }finally{sqlite.close();}
});
it('建立成功但同步失敗仍回傳來源 ID；同操作重試只補同步、不再建立',async()=>{
 const {db,sqlite}=testDatabase();try{
  const operationId=crypto.randomUUID(),id=`kd_${operationId.replaceAll('-','')}`;let pulls=0,creates=0;
  const fixture=client((url,init)=>{
   const scope=identity(url);if(scope)return scope;
   if(init?.method==='POST'){creates++;return Response.json({...coupon,id});}
   if(++pulls===1)return Response.json({error:{type:'api_error',message:'private failure'}},{status:500});
   return Response.json({...coupon,id});
  });
  const connection=await connectStripeDiscounts('sk_fixture',fixture.client);
  const action={action:'createCoupon',operationId,expectedScope:connection.scope,input:{discount:{kind:'percent',percentOff:25}}};
  expect(await executeDiscountAction(db,secret,connection,action)).toMatchObject({sourceId:id,synced:false});
  expect(await executeDiscountAction(db,secret,connection,action)).toMatchObject({sourceId:id,synced:true});expect(creates).toBe(1);
  expect(await executeDiscountAction(db,secret,connection,{action:'read',kind:'coupon',sourceId:id})).toMatchObject({record:{fresh:true,snapshot:{id,percent_off:25}}});
 }finally{sqlite.close();}
});
it('管理員匯入先讀促銷碼及 Coupon，再建立來源關聯；重試只回傳原批次',async()=>{
 const {createProduct}=await import('../src/lib/server/inventory');
 const {db,sqlite}=testDatabase();try{
  const product=await createProduct(db,{name:'Imported',slug:'imported'});
  const promotion={id:'promo_fixture',object:'promotion_code',livemode:false,active:true,code:'IMPORTED',promotion:{type:'coupon',coupon:coupon.id},customer:null,customer_account:null,expires_at:null,max_redemptions:null,times_redeemed:0,restrictions:{first_time_transaction:false,minimum_amount:null,minimum_amount_currency:null}};
  const fixture=client(url=>identity(url)??Response.json(url.pathname.includes('/promotion_codes/')?promotion:coupon));
  const connection=await connectStripeDiscounts('sk_fixture',fixture.client);
  const action={action:'importPromotion',expectedScope:connection.scope,input:{productId:product.id,promotionId:promotion.id,name:'Stripe batch',distributionMode:'shared',sharedClaimLimit:5}};
  const first=await executeDiscountAction(db,secret,connection,action);expect(first).toHaveProperty('batchId');
  expect(await executeDiscountAction(db,secret,connection,action)).toEqual(first);
  expect(sqlite.prepare('SELECT count(*) n FROM stripe_inventory_links').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT count(*) n FROM codes').get()?.n).toBe(1);
  expect(fixture.fetcher.mock.calls.every(([,init])=>init?.method==='GET')).toBe(true);
 }finally{sqlite.close();}
});
it('批量匯入逐筆回報並遮蔽外部錯誤，重試不重複建立，整批先驗證範圍與上限',async()=>{
 const {createProduct}=await import('../src/lib/server/inventory');
 const {db,sqlite}=testDatabase();try{
  const product=await createProduct(db,{name:'Bulk',slug:'bulk'});let available=false;
  const fixture=client(url=>{
   const account=identity(url);if(account)return account;
   if(!url.pathname.includes('/promotion_codes/'))return Response.json(coupon);
   const id=url.pathname.split('/').at(-1)!;
   if(id==='promo_bad'&&!available)return Response.json({error:{type:'api_error',message:'private Stripe details'}},{status:500});
   return Response.json({id,object:'promotion_code',livemode:false,active:id!=='promo_inactive',code:id.toUpperCase(),promotion:{type:'coupon',coupon:coupon.id},customer:null,customer_account:null,expires_at:null,max_redemptions:null,times_redeemed:0,restrictions:{first_time_transaction:false,minimum_amount:null,minimum_amount_currency:null}});
  });
  const connection=await connectStripeDiscounts('fixture',fixture.client);
  const action={action:'importPromotions',expectedScope:connection.scope,input:{productId:product.id,promotionIds:['promo_good','promo_bad','promo_inactive'],name:'Batch'}};
  const first=await executeDiscountAction(db,secret,connection,action);
  expect(first).toMatchObject({results:[{promotionId:'promo_good',batchId:expect.any(String)},{promotionId:'promo_bad',error:'STRIPE_IMPORT_FAILED'},{promotionId:'promo_inactive',error:'STRIPE_INVENTORY_UNAVAILABLE'}]});
  expect(JSON.stringify(first)).not.toContain('private Stripe');
  expect(sqlite.prepare('SELECT count(*) n FROM codes').get()?.n).toBe(1);
  available=true;
  const second=await executeDiscountAction(db,secret,connection,action);
  expect(second).toMatchObject({results:[{promotionId:'promo_good',batchId:expect.any(String)},{promotionId:'promo_bad',batchId:expect.any(String)},{promotionId:'promo_inactive',error:'STRIPE_INVENTORY_UNAVAILABLE'}]});
  expect(sqlite.prepare('SELECT count(*) n FROM codes').get()?.n).toBe(2);
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(2);
  const calls=fixture.fetcher.mock.calls.length;
  for(const promotionIds of [[],['promo_good','promo_good'],Array.from({length:26},(_,i)=>`promo_${i}`)]){
   await expect(executeDiscountAction(db,secret,connection,{...action,input:{...action.input,promotionIds}})).rejects.toThrow();
  }
  await expect(executeDiscountAction(db,secret,connection,{...action,expectedScope:{...connection.scope,livemode:true}})).rejects.toThrow('STRIPE_CONNECTION_CHANGED');
  expect(fixture.fetcher).toHaveBeenCalledTimes(calls);
 }finally{sqlite.close();}
});
