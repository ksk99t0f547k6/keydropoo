import {it,expect,vi} from 'vitest';
import Stripe from 'stripe';
import {testDatabase} from './d1';
import {stripeDiscountGateway} from '../src/lib/server/stripe-discounts';
import {maintainStripeDiscounts,stripeSyncStatus} from '../src/lib/server/stripe-discount-maintenance';
const secret='ab'.repeat(32),scope={accountId:'acct_fixture',livemode:false};
function connection(run:(id:string)=>Promise<Response>|Response){
 const fetcher=vi.fn<typeof fetch>(async(url)=>run(decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!)));
 const gateway=stripeDiscountGateway(new Stripe('sk_test_fixture',{httpClient:Stripe.createFetchHttpClient(fetcher),maxNetworkRetries:0}));
 return {connect:vi.fn(async()=>({scope,gateway})),fetcher};
}
function coupon(id:string){return Response.json({id,object:'coupon',livemode:false,valid:true,name:null,amount_off:null,percent_off:25,currency:null,duration:'once',duration_in_months:null,max_redemptions:null,times_redeemed:0,redeem_by:null});}
function seed(sqlite:ReturnType<typeof testDatabase>['sqlite'],id:string,account='acct_fixture'){
 sqlite.prepare("INSERT INTO stripe_discount_catalog(account_id,livemode,kind,source_id,requested_at) VALUES(?,0,'coupon',?,0)").run(account,id);
}
it('空目錄不連 Stripe；分批按最久未查詢輪替，失敗不餓死後續來源',async()=>{
 const {db,sqlite}=testDatabase();try{
  const api=connection(id=>id==='a'?Response.json({error:{type:'api_error',message:'private failure'}},{status:500}):coupon(id));
  expect(await maintainStripeDiscounts(db,{stripeSecret:'fixture',encryptionSecret:secret},1000000,api.connect)).toMatchObject({skipped:true});expect(api.connect).not.toHaveBeenCalled();
  for(const id of ['a','b','c'])seed(sqlite,id);
  expect(await maintainStripeDiscounts(db,{stripeSecret:'fixture',encryptionSecret:secret,batchSize:2},1000000,api.connect)).toEqual({checked:2,failed:1,skipped:false});
  const status=await stripeSyncStatus(db);
  expect(status).toMatchObject({checked:2,failed:1,last_error:'STRIPE_SYNC_PARTIAL_FAILURE'});
  expect(status).not.toHaveProperty('lease_token');
  expect(await maintainStripeDiscounts(db,{stripeSecret:'fixture',encryptionSecret:secret,batchSize:2},1000100,api.connect)).toEqual({checked:1,failed:0,skipped:false});
  expect(api.fetcher.mock.calls.map(([url])=>new URL(String(url)).pathname.split('/').at(-1))).toEqual(['a','b','c']);
 }finally{sqlite.close();}
});
it('缺設定、身分查詢失敗與換帳戶會停用不可信快照，不洩漏原始錯誤',async()=>{
 const {db,sqlite}=testDatabase();try{
  seed(sqlite,'a');seed(sqlite,'other','acct_other');const api=connection(coupon);
  await maintainStripeDiscounts(db,{},1000000,api.connect);expect(api.connect).not.toHaveBeenCalled();expect((await stripeSyncStatus(db))?.last_error).toBe('STRIPE_SYNC_NOT_CONFIGURED');
  api.connect.mockRejectedValueOnce(new Error('private credential error'));
  await maintainStripeDiscounts(db,{stripeSecret:'fixture',encryptionSecret:secret},1000100,api.connect);expect((await stripeSyncStatus(db))?.last_error).toBe('STRIPE_IDENTITY_UNAVAILABLE');
  await maintainStripeDiscounts(db,{stripeSecret:'fixture',encryptionSecret:secret},1000200,api.connect);
  expect(sqlite.prepare("SELECT last_error FROM stripe_discount_catalog WHERE account_id='acct_other'").get()?.last_error).toBe('STRIPE_CONNECTION_CHANGED');
  expect(sqlite.prepare("SELECT last_error FROM stripe_discount_catalog WHERE account_id='acct_fixture'").get()?.last_error).toBeNull();
  expect(api.fetcher).toHaveBeenCalledTimes(1);
 }finally{sqlite.close();}
});
it('排程重疊只由租約持有人查詢，過期程序不能清除新租約',async()=>{
 const {db,sqlite}=testDatabase();try{
  seed(sqlite,'a');let start:()=>void=()=>{},release:()=>void=()=>{};const began=new Promise<void>(r=>{start=r;}),gate=new Promise<void>(r=>{release=r;});
  const api=connection(async id=>{start();await gate;return coupon(id);});
  const pending=maintainStripeDiscounts(db,{stripeSecret:'fixture',encryptionSecret:secret},1000000,api.connect);await began;
  expect(await maintainStripeDiscounts(db,{stripeSecret:'fixture',encryptionSecret:secret},1000001,api.connect)).toMatchObject({skipped:true});expect(api.connect).toHaveBeenCalledTimes(1);
  sqlite.prepare("UPDATE stripe_sync_state SET lease_token='new-owner',lease_until=9000000 WHERE id=1").run();release();await pending;
  expect(sqlite.prepare('SELECT lease_token,lease_until FROM stripe_sync_state').get()).toEqual({lease_token:'new-owner',lease_until:9000000});
 }finally{sqlite.close();}
});
it('不合法批量設定使用安全預設並留下狀態，不讓其他排程工作因設定例外中斷',async()=>{
 const {db,sqlite}=testDatabase();try{
  seed(sqlite,'a');const api=connection(coupon);
  expect(await maintainStripeDiscounts(db,{stripeSecret:'fixture',encryptionSecret:secret,batchSize:NaN},1000000,api.connect)).toEqual({checked:1,failed:0,skipped:false});
  expect((await stripeSyncStatus(db))?.last_error).toBe('STRIPE_SYNC_INVALID_BATCH_SIZE');
 }finally{sqlite.close();}
});
