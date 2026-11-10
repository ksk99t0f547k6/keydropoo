import Stripe from 'stripe';
import {z} from 'zod';

const stripeId=z.string().min(1).max(255).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
const count=z.number().int().nonnegative().safe();
const positive=count.min(1);
const currency=z.string().regex(/^[a-z]{3}$/);
const reference=z.union([stripeId,z.object({id:stripeId})]).nullable().transform(value=>typeof value==='string'?value:value?.id??null);
// 金額保留 Stripe 的最小貨幣單位；不能與 Keydrop 的顯示金額直接混用。
export const stripeCouponSnapshot=z.object({
 id:stripeId,object:z.literal('coupon'),livemode:z.boolean(),valid:z.boolean(),
 name:z.string().nullable(),amount_off:positive.nullable(),percent_off:z.number().positive().max(100).nullable(),currency:currency.nullable(),
 duration:z.enum(['once','forever','repeating']),duration_in_months:positive.nullable(),
 max_redemptions:positive.nullable(),times_redeemed:count,redeem_by:positive.nullable(),
 applies_to:z.object({products:z.array(stripeId)}).optional(),
 currency_options:z.record(currency,z.object({amount_off:positive})).optional(),
}).refine(value=>value.amount_off!==null?value.percent_off===null&&value.currency!==null:value.percent_off!==null,'INVALID_STRIPE_DISCOUNT');
export const stripePromotionSnapshot=z.object({
 id:stripeId,object:z.literal('promotion_code'),livemode:z.boolean(),active:z.boolean(),code:z.string().min(1).max(500),
 promotion:z.object({type:z.literal('coupon'),coupon:reference}),
 customer:reference,customer_account:stripeId.nullable(),expires_at:positive.nullable(),max_redemptions:positive.nullable(),times_redeemed:count,
 restrictions:z.object({first_time_transaction:z.boolean(),minimum_amount:count.nullable(),minimum_amount_currency:currency.nullable(),
  currency_options:z.record(currency,z.object({minimum_amount:count})).optional()}),
}).refine(value=>value.promotion.coupon!==null,'STRIPE_COUPON_MISSING');
export type StripeCouponSnapshot=z.infer<typeof stripeCouponSnapshot>;
export type StripePromotionSnapshot=z.infer<typeof stripePromotionSnapshot>;
const pageInput=z.object({limit:z.number().int().min(1).max(100).default(100),startingAfter:stripeId.optional()}).strict();
const envelope=z.object({object:z.literal('list'),data:z.array(z.unknown()).max(100),has_more:z.boolean()});
function page<T extends {id:string}>(raw:unknown,parse:(value:unknown)=>T){
 const result=envelope.parse(raw),items=result.data.map(parse);
 if(result.has_more&&!items.length)throw new Error('STRIPE_PAGINATION_INVALID');
 return {items,nextCursor:result.has_more?items.at(-1)!.id:null};
}
const duration={duration:z.enum(['once','forever','repeating']).default('once'),durationInMonths:positive.optional()};
export const stripeCouponCreate=z.object({
 name:z.string().trim().min(1).max(40).optional(),...duration,
 discount:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('percent'),percentOff:z.number().positive().max(100)}).strict(),
  z.object({kind:z.literal('amount'),amountOff:positive,currency,currencyOptions:z.record(currency,positive).optional()}).strict(),
 ]),
 productIds:z.array(stripeId).min(1).max(100).optional(),maxRedemptions:positive.optional(),redeemBy:positive.optional(),
}).strict().refine(value=>value.duration==='repeating'?value.durationInMonths!==undefined:value.durationInMonths===undefined,'INVALID_DISCOUNT_DURATION');
export const stripePromotionCreate=z.object({
 couponId:stripeId,code:z.string().min(1).max(500).regex(/^[a-zA-Z0-9-]+$/),
 active:z.boolean().default(true),customerId:stripeId.optional(),customerAccount:stripeId.optional(),
 expiresAt:positive.optional(),maxRedemptions:positive.optional(),firstTimeTransaction:z.boolean().default(false),
 minimumAmount:count.optional(),minimumAmountCurrency:currency.optional(),
}).strict().refine(value=>(value.minimumAmount===undefined)===(value.minimumAmountCurrency===undefined),'INVALID_MINIMUM_AMOUNT')
 .refine(value=>!(value.customerId&&value.customerAccount),'INVALID_CUSTOMER_RESTRICTION');

export class StripeDiscountMissingError extends Error {
 constructor(){super('STRIPE_DISCOUNT_MISSING');}
}
async function retrieve<T>(request:()=>Promise<T>):Promise<T>{
 try{return await request();}catch(error){
  if(error instanceof Stripe.errors.StripeInvalidRequestError&&error.statusCode===404&&error.code==='resource_missing')throw new StripeDiscountMissingError();
  throw error;
 }
}

// 呼叫端須先持久化操作 ID 與請求快照；Stripe 的冪等保留期不是永久的去重資料庫。
export function stripeDiscountGateway(client:Stripe){return {
 async recoveryCoupon(id:string){const raw=await retrieve(()=>client.coupons.retrieve(stripeId.parse(id)));return {snapshot:stripeCouponSnapshot.parse(raw),operationId:raw.metadata?.keydrop_operation_id??null};},
 async recoveryPromotion(id:string){const raw=await retrieve(()=>client.promotionCodes.retrieve(stripeId.parse(id)));return {snapshot:stripePromotionSnapshot.parse(raw),operationId:raw.metadata?.keydrop_operation_id??null};},
 async listCoupons(raw:unknown={}){const input=pageInput.parse(raw);return page(await client.coupons.list({limit:input.limit,starting_after:input.startingAfter}),value=>stripeCouponSnapshot.parse(value));},
 async listPromotions(raw:unknown={}){const input=pageInput.parse(raw);return page(await client.promotionCodes.list({limit:input.limit,starting_after:input.startingAfter}),value=>stripePromotionSnapshot.parse(value));},
 async retrieveCoupon(id:string){const result=stripeCouponSnapshot.parse(await retrieve(()=>client.coupons.retrieve(stripeId.parse(id))));if(result.id!==id)throw new Error('STRIPE_DISCOUNT_MISMATCH');return result;},
 async retrievePromotion(id:string){const result=stripePromotionSnapshot.parse(await retrieve(()=>client.promotionCodes.retrieve(stripeId.parse(id))));if(result.id!==id)throw new Error('STRIPE_DISCOUNT_MISMATCH');return result;},
 async createCoupon(operationId:string,raw:unknown){
  z.uuid().parse(operationId);const input=stripeCouponCreate.parse(raw);
  const params:Stripe.CouponCreateParams={
   id:`kd_${operationId.replaceAll('-','')}`,name:input.name,duration:input.duration,duration_in_months:input.durationInMonths,
   max_redemptions:input.maxRedemptions,redeem_by:input.redeemBy,applies_to:input.productIds?{products:input.productIds}:undefined,
   metadata:{keydrop_operation_id:operationId},
   ...(input.discount.kind==='percent'?{percent_off:input.discount.percentOff}:{amount_off:input.discount.amountOff,currency:input.discount.currency,
    currency_options:input.discount.currencyOptions?Object.fromEntries(Object.entries(input.discount.currencyOptions).map(([key,amount_off])=>[key,{amount_off}])):undefined}),
  };
  const result=stripeCouponSnapshot.parse(await client.coupons.create(params,{idempotencyKey:`keydrop-coupon-${operationId}`}));
  if(result.id!==params.id)throw new Error('STRIPE_DISCOUNT_MISMATCH');return result;
 },
 async createPromotion(operationId:string,raw:unknown){
  z.uuid().parse(operationId);const input=stripePromotionCreate.parse(raw);
  const params:Stripe.PromotionCodeCreateParams={promotion:{type:'coupon',coupon:input.couponId},code:input.code,active:input.active,
   customer:input.customerId,customer_account:input.customerAccount,expires_at:input.expiresAt,max_redemptions:input.maxRedemptions,
   metadata:{keydrop_operation_id:operationId},restrictions:{first_time_transaction:input.firstTimeTransaction,minimum_amount:input.minimumAmount,minimum_amount_currency:input.minimumAmountCurrency}};
  const result=stripePromotionSnapshot.parse(await client.promotionCodes.create(params,{idempotencyKey:`keydrop-promotion-${operationId}`}));
  if(result.promotion.coupon!==input.couponId||result.code.toLowerCase()!==input.code.toLowerCase())throw new Error('STRIPE_DISCOUNT_MISMATCH');return result;
 },
};}
