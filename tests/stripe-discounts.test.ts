import {expect,it,vi} from 'vitest';
import Stripe from 'stripe';
import {stripeDiscountGateway} from '../src/lib/server/stripe-discounts';
const coupon={id:'coupon_fixture',object:'coupon',livemode:false,valid:true,name:'Fixture',amount_off:null,percent_off:25.5,currency:null,duration:'once',duration_in_months:null,max_redemptions:20,times_redeemed:3,redeem_by:1900000000,applies_to:{products:['prod_fixture']}};
const promotion={id:'promo_fixture',object:'promotion_code',livemode:false,active:true,code:'TEST-25',promotion:{type:'coupon',coupon:'coupon_fixture'},customer:'cus_fixture',customer_account:null,expires_at:1890000000,max_redemptions:10,times_redeemed:2,restrictions:{first_time_transaction:true,minimum_amount:1000,minimum_amount_currency:'usd',currency_options:{jpy:{minimum_amount:500}}}};
function setup(responses:unknown[]){
 const requests:{url:string;body:URLSearchParams;headers:Headers}[]=[];
 const fetcher=vi.fn<typeof fetch>(async(url,init)=>{
  requests.push({url:String(url),body:new URLSearchParams(String(init?.body??'')),headers:new Headers(init?.headers)});
  const value=responses.shift();if(value===undefined)throw new Error('Unexpected request');
  return Response.json(value);
 });
 const client=new Stripe('sk_test_fixture',{httpClient:Stripe.createFetchHttpClient(fetcher),maxNetworkRetries:0});
 return {gateway:stripeDiscountGateway(client),requests,fetcher};
}
it('官方 SDK 分頁保留限制與游標，不把展開的客戶個資或 metadata 存進快照',async()=>{
 const {gateway,requests}=setup([{object:'list',has_more:true,data:[coupon]},{object:'list',has_more:false,data:[{...promotion,customer:{id:'cus_fixture',email:'private@example.test'},metadata:{private:'hidden'}}]}]);
 const first=await gateway.listCoupons({limit:10});expect(first.nextCursor).toBe(coupon.id);expect(first.items[0]).toEqual(coupon);
 const second=await gateway.listPromotions({limit:10,startingAfter:'promo_previous'});
 expect(new URL(requests[1].url).searchParams.get('starting_after')).toBe('promo_previous');
 expect(second.items[0]).toEqual(promotion);expect(second.nextCursor).toBeNull();
});
it('建立折扣使用固定 Coupon ID 與冪等鍵，保留不同貨幣最小單位與週期',async()=>{
 const operation=crypto.randomUUID(),id=`kd_${operation.replaceAll('-','')}`;
 const result={...coupon,id,amount_off:500,percent_off:null,currency:'usd',duration:'repeating',duration_in_months:3,currency_options:{jpy:{amount_off:100}}};
 const {gateway,requests}=setup([result,result]);
 const input={discount:{kind:'amount',amountOff:500,currency:'usd',currencyOptions:{jpy:100}},duration:'repeating',durationInMonths:3,productIds:['prod_fixture'],maxRedemptions:20};
 await gateway.createCoupon(operation,input);await gateway.createCoupon(operation,input);
 expect(requests[0].body.toString()).toBe(requests[1].body.toString());
 expect(requests[0].body.get('id')).toBe(id);expect(requests[0].body.get('currency_options[jpy][amount_off]')).toBe('100');
 expect(requests[0].body.get('duration_in_months')).toBe('3');expect(requests[0].headers.get('Idempotency-Key')).toBe(`keydrop-coupon-${operation}`);
});
it('建立分發碼使用目前 promotion.coupon 協定並保留客戶及最低金額限制',async()=>{
 const {gateway,requests}=setup([promotion]);const operation=crypto.randomUUID();
 await gateway.createPromotion(operation,{couponId:coupon.id,code:promotion.code,customerId:'cus_fixture',minimumAmount:1000,minimumAmountCurrency:'usd',firstTimeTransaction:true,maxRedemptions:10});
 expect(requests[0].body.get('promotion[type]')).toBe('coupon');expect(requests[0].body.get('promotion[coupon]')).toBe(coupon.id);
 expect(requests[0].body.get('customer')).toBe('cus_fixture');expect(requests[0].body.get('restrictions[minimum_amount]')).toBe('1000');
 expect(requests[0].headers.get('Idempotency-Key')).toBe(`keydrop-promotion-${operation}`);
});
it('無效規則不送請求；空白續頁、未知促銷種類及錯誤識別不可匯入',async()=>{
 const {gateway,fetcher}=setup([{object:'list',has_more:true,data:[]},{...promotion,promotion:{type:'other',coupon:null}},{...coupon,id:'wrong'}]);
 await expect(gateway.createCoupon(crypto.randomUUID(),{discount:{kind:'percent',percentOff:101}})).rejects.toThrow();
 await expect(gateway.createPromotion(crypto.randomUUID(),{couponId:coupon.id,code:'BAD_CODE',minimumAmount:100})).rejects.toThrow();
 expect(fetcher).not.toHaveBeenCalled();
 await expect(gateway.listCoupons()).rejects.toThrow('STRIPE_PAGINATION_INVALID');
 await expect(gateway.retrievePromotion(promotion.id)).rejects.toThrow();
 await expect(gateway.retrieveCoupon(coupon.id)).rejects.toThrow('STRIPE_DISCOUNT_MISMATCH');
});
it('只有 Stripe 的 resource_missing 404 轉成已不存在，權限失敗不可誤刪',async()=>{
 const {StripeDiscountMissingError}=await import('../src/lib/server/stripe-discounts');
 const responses=[new Response(JSON.stringify({error:{type:'invalid_request_error',code:'resource_missing',message:'No such coupon'}}),{status:404,headers:{'Content-Type':'application/json'}}),new Response(JSON.stringify({error:{type:'invalid_request_error',code:'permission_error',message:'Forbidden'}}),{status:403,headers:{'Content-Type':'application/json'}})];
 const client=new Stripe('sk_test_fixture',{httpClient:Stripe.createFetchHttpClient(async()=>responses.shift()!),maxNetworkRetries:0});
 const gateway=stripeDiscountGateway(client);
 await expect(gateway.retrieveCoupon('missing')).rejects.toBeInstanceOf(StripeDiscountMissingError);
 await expect(gateway.retrieveCoupon('forbidden')).rejects.not.toBeInstanceOf(StripeDiscountMissingError);
});
