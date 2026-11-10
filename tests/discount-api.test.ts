import {it,expect,vi} from 'vitest';
import Stripe from 'stripe';
import {testDatabase} from './d1';
import {executeApiOperation,type ApiServices} from '../src/lib/server/api-operations';
import type {ApiPrincipal} from '../src/lib/server/api-tokens';
import {stripeDiscountGateway} from '../src/lib/server/stripe-discounts';
const principal:ApiPrincipal={id:'fixture',scopes:['discounts:read','discounts:write'],productIds:null,mcpWriteEnabled:false};
function service(){
 const gateway=stripeDiscountGateway(new Stripe('sk_test_fixture',{maxNetworkRetries:0,httpClient:Stripe.createFetchHttpClient(async()=>{throw new Error('Unexpected network access');})}));
 return vi.fn(async()=>({encryptionSecret:'ab'.repeat(32),connection:{scope:{accountId:'acct_fixture',livemode:false},gateway}}));
}
it('商品限定與缺少權限在連 Stripe 之前拒絕，唯讀 schema 不接受寫入',async()=>{
 const {db,sqlite}=testDatabase();try{
  const discounts=service(),services:ApiServices={discounts};
  const read={action:'discounts.read',request:{action:'connection'}};
  for(const identity of [{...principal,productIds:[crypto.randomUUID()]},{...principal,scopes:[] }]){
   await expect(executeApiOperation(db,identity,read,services)).rejects.toThrow('API_SCOPE_DENIED');
  }
  await expect(executeApiOperation(db,principal,{action:'discounts.read',request:{action:'sync',kind:'coupon',sourceId:'coupon_1',expectedScope:{accountId:'acct_fixture',livemode:false}}},services)).rejects.toThrow();
  await expect(executeApiOperation(db,principal,{action:'discounts.write',request:{action:'importPromotion',expectedScope:{accountId:'acct_fixture',livemode:false},input:{productId:crypto.randomUUID(),promotionId:'promo_1',name:'Imported'}}},services)).rejects.toThrow('API_SCOPE_DENIED');
  expect(discounts).not.toHaveBeenCalled();
  expect(await executeApiOperation(db,principal,read,services)).toEqual({accountId:'acct_fixture',livemode:false});
  expect(await executeApiOperation(db,principal,{action:'discounts.read',request:{action:'catalog',kind:'coupon'}},services)).toMatchObject({scope:{accountId:'acct_fixture',livemode:false}});
  await expect(executeApiOperation(db,principal,{action:'discounts.write',request:{action:'sync',kind:'coupon',sourceId:'coupon_1',expectedScope:{accountId:'acct_other',livemode:false}}},services)).rejects.toThrow('STRIPE_CONNECTION_CHANGED');
  expect(sqlite.prepare('SELECT count(*) n FROM stripe_discount_catalog').get()?.n).toBe(0);
 }finally{sqlite.close();}
});
it('公開寫入入口沿用建立日誌與 Stripe 冪等操作，唯讀權限不能建立',async()=>{
 const {db,sqlite}=testDatabase();try{
  const operationId=crypto.randomUUID(),couponId=`kd_${operationId.replaceAll('-','')}`;let created=0;
  const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{
   if(init?.method==='POST')created++;
   return Response.json({id:couponId,object:'coupon',livemode:false,valid:true,name:null,amount_off:null,percent_off:25,currency:null,duration:'once',duration_in_months:null,max_redemptions:null,times_redeemed:0,redeem_by:null});
  });
  const gateway=stripeDiscountGateway(new Stripe('sk_test_fixture',{httpClient:Stripe.createFetchHttpClient(fetcher),maxNetworkRetries:0}));
  const scope={accountId:'acct_fixture',livemode:false},discounts=vi.fn(async()=>({encryptionSecret:'ab'.repeat(32),connection:{scope,gateway}}));
  const raw={action:'discounts.write',request:{action:'createCoupon',expectedScope:scope,operationId,input:{discount:{kind:'percent',percentOff:25}}}};
  await expect(executeApiOperation(db,{...principal,scopes:['discounts:read']},raw,{discounts})).rejects.toThrow('API_SCOPE_DENIED');
  expect(discounts).not.toHaveBeenCalled();
  const first=await executeApiOperation(db,principal,raw,{discounts});
  expect(first).toMatchObject({sourceId:couponId,synced:true});
  expect(await executeApiOperation(db,principal,raw,{discounts})).toMatchObject({sourceId:couponId,synced:true});expect(created).toBe(1);
  expect(sqlite.prepare('SELECT count(*) n FROM stripe_discount_operations').get()?.n).toBe(1);
 }finally{sqlite.close();}
});
