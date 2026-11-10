import Stripe from "stripe";
import {z} from "zod";
import {currencyDigits} from "../domain/money";
import {fingerprint} from "../domain/codes";
import {ASYNC_PAYMENT_HOLD_MS,attachCheckout,getOrder,settleOrder,type OrderRow} from "./orders";

const zeroDecimal=new Set(["BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","VND","VUV","XAF","XOF","XPF"]);
const threeDecimal=new Set(["BHD","JOD","KWD","OMR","TND"]);
function stripeDigits(currency:string){return zeroDecimal.has(currency)?0:threeDecimal.has(currency)?3:2;}
function scaleAmount(amount:number,from:number,to:number){
 z.number().int().nonnegative().safe().parse(amount);
 const numerator=BigInt(amount)*10n**BigInt(to),denominator=10n**BigInt(from);
 if(numerator%denominator!==0n||numerator/denominator>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("STRIPE_AMOUNT_UNREPRESENTABLE");
 return Number(numerator/denominator);
}
export function toStripeAmount(amount:number,currency:string){
 const scaled=scaleAmount(amount,currencyDigits(currency),stripeDigits(currency));
 if(threeDecimal.has(currency)&&scaled%10!==0)throw new Error("STRIPE_AMOUNT_UNREPRESENTABLE");return scaled;
}
export function fromStripeAmount(amount:number,currency:string){return scaleAmount(amount,stripeDigits(currency),currencyDigits(currency));}
export function stripeClient(secret:string){return new Stripe(secret,{httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:2,timeout:15000});}
export interface StripeGateway {
 createCheckout:(params:Stripe.Checkout.SessionCreateParams,key:string)=>Promise<unknown>;
 retrieveProduct?:(id:string)=>Promise<unknown>;
 retrieveCheckout:(id:string)=>Promise<unknown>;
 retrievePaymentIntent:(id:string)=>Promise<unknown>;
 succeededRefundAmount:(paymentIntentId:string)=>Promise<number>;
 createRefund:(paymentIntentId:string,orderId:string)=>Promise<unknown>;
 retrieveCharge:(id:string)=>Promise<unknown>;
 retrieveRefund:(id:string)=>Promise<unknown>;
}
export function stripeGateway(client:Stripe):StripeGateway{return {
 createCheckout:(params,key)=>client.checkout.sessions.create(params,{idempotencyKey:key}),
 retrieveProduct:id=>client.products.retrieve(id),
 retrieveCheckout:id=>client.checkout.sessions.retrieve(id),
 retrievePaymentIntent:id=>client.paymentIntents.retrieve(id),
 succeededRefundAmount:async payment_intent=>{let total=0,count=0;for await(const refund of client.refunds.list({payment_intent,limit:100})){if(++count>10000)throw new Error("STRIPE_REFUNDS_TOO_MANY");if(refund.status==='succeeded')total+=refund.amount;}return total;},
 createRefund:(payment_intent,orderId)=>client.refunds.create({payment_intent,metadata:{keydrop_order_id:orderId}},{idempotencyKey:`keydrop-refund-${orderId}`}),
 retrieveCharge:id=>client.charges.retrieve(id),retrieveRefund:id=>client.refunds.retrieve(id),
};}
const reference=z.union([z.string(),z.object({id:z.string()})]).nullable();
const sessionSchema=z.object({id:z.string(),metadata:z.record(z.string(),z.string()).nullable(),client_reference_id:z.string().nullable(),status:z.enum(["open","complete","expired"]).nullable(),payment_status:z.enum(["paid","unpaid","no_payment_required"]),payment_intent:reference,amount_total:z.number().int().nonnegative().nullable(),amount_subtotal:z.number().int().nonnegative().nullable().optional(),total_details:z.object({amount_discount:z.number().int().nonnegative(),amount_tax:z.number().int().nonnegative(),amount_shipping:z.number().int().nonnegative()}).nullable().optional(),currency:z.string().nullable(),url:z.url().nullable().optional()});
const intentSchema=z.object({id:z.string(),metadata:z.record(z.string(),z.string()),status:z.string(),amount_received:z.number().int(),currency:z.string()});
function refId(value:z.infer<typeof reference>){return typeof value==='string'?value:value?.id??null;}

export async function createOrderCheckout(db:D1Database,gateway:StripeGateway,order:OrderRow,appUrl:string,now=Date.now()){
 if(order.checkout_session_id){const session=sessionSchema.parse(await gateway.retrieveCheckout(order.checkout_session_id));return {orderId:order.id,url:session.status==='open'?session.url??null:null};}
 if(order.status!=="pending"||order.reserved_until<=now)throw new Error("ORDER_CHECKOUT_EXPIRED");
 const product=await db.prepare("SELECT name,allow_promotion_codes,stripe_product_id FROM products WHERE id=?").bind(order.product_id).first<{name:string;allow_promotion_codes:number;stripe_product_id:string|null}>();if(!product)throw new Error("PRODUCT_NOT_FOUND");
 const params:Stripe.Checkout.SessionCreateParams={mode:"payment",managed_payments:{enabled:false},automatic_tax:{enabled:false},adaptive_pricing:{enabled:false},allow_promotion_codes:!!product.allow_promotion_codes,client_reference_id:order.id,metadata:{keydrop_order_id:order.id},payment_intent_data:{metadata:{keydrop_order_id:order.id}},line_items:[{quantity:1,price_data:{currency:order.currency.toLowerCase(),unit_amount:toStripeAmount(order.amount_minor,order.currency),...(product.stripe_product_id?{product:product.stripe_product_id}:{product_data:{name:product.name}})}}],expires_at:Math.floor((order.reserved_until-60000)/1000),success_url:`${appUrl}/orders/${order.id}`,cancel_url:`${appUrl}/orders/${order.id}`,...(order.email?{customer_email:order.email}:{})};
 // 將建立參數固定下來，商品名稱修改或請求重試仍使用相同 Stripe 冪等內容。
 await db.prepare("UPDATE orders SET checkout_payload_json=COALESCE(checkout_payload_json,?) WHERE id=?").bind(JSON.stringify(params),order.id).run();
 const stored=await db.prepare("SELECT checkout_payload_json FROM orders WHERE id=?").bind(order.id).first<{checkout_payload_json:string}>();
 const payload=JSON.parse(stored!.checkout_payload_json) as Stripe.Checkout.SessionCreateParams;
 const linkedProduct=payload.line_items?.[0]?.price_data?.product;
 if(linkedProduct){
  try{const remote=z.object({id:z.literal(linkedProduct),object:z.literal('product'),active:z.literal(true)}).parse(await gateway.retrieveProduct?.(linkedProduct));if(!remote)throw new Error();}
  catch{throw new Error('STRIPE_PRODUCT_UNAVAILABLE');}
 }
 const session=sessionSchema.parse(await gateway.createCheckout(payload,`keydrop-checkout-${order.id}`));
 await attachCheckout(db,order.id,session.id);
 return {orderId:order.id,url:session.url??null};
}
export async function reconcileCheckout(db:D1Database,gateway:StripeGateway,sessionId:string,now=Date.now()){
 const session=sessionSchema.parse(await gateway.retrieveCheckout(sessionId));
 const id=session.metadata?.keydrop_order_id;if(!id)return null;
 const order=await getOrder(db,id);if(!order)throw new Error("ORDER_NOT_FOUND");
 const prepared=await db.prepare("SELECT checkout_payload_json FROM orders WHERE id=?").bind(id).first<{checkout_payload_json:string|null}>();
 const allowsDiscounts=prepared?.checkout_payload_json?JSON.parse(prepared.checkout_payload_json).allow_promotion_codes===true:false;
 const original=toStripeAmount(order.amount_minor,order.currency);
 if(session.id!==sessionId||session.client_reference_id!==order.id||session.currency?.toUpperCase()!==order.currency)throw new Error("ORDER_PAYMENT_MISMATCH");
 if(allowsDiscounts){
  const details=session.total_details;
  if(session.amount_subtotal!==original||!details||details.amount_tax!==0||details.amount_shipping!==0||details.amount_discount>original||session.amount_total!==original-details.amount_discount)throw new Error("ORDER_PAYMENT_MISMATCH");
 }else if(session.amount_total!==original)throw new Error("ORDER_PAYMENT_MISMATCH");
 if(order.checkout_session_id===null){
  if(!prepared?.checkout_payload_json)throw new Error("ORDER_SESSION_CONFLICT");
  await attachCheckout(db,id,session.id);
 }else if(order.checkout_session_id!==session.id)throw new Error("ORDER_SESSION_CONFLICT");
 if(session.status==='expired'&&order.paid_at===null){await db.prepare("UPDATE orders SET status='expired',updated_at=? WHERE id=? AND status='pending' AND paid_at IS NULL").bind(now,id).run();return getOrder(db,id);}
 if(session.status==='complete'&&session.payment_status==='unpaid'&&order.paid_at===null){
  // 非同步付款已送出但尚未入帳：延長預留等待 async_payment_succeeded／failed，不讓碼先被排程釋放。
  await db.prepare("UPDATE orders SET reserved_until=MAX(reserved_until,?),updated_at=? WHERE id=? AND status='pending' AND paid_at IS NULL").bind(now+ASYNC_PAYMENT_HOLD_MS,now,id).run();
  return getOrder(db,id);
 }
 if(session.status!=='complete'||!['paid','no_payment_required'].includes(session.payment_status))return order;
 const chargedMinor=fromStripeAmount(session.amount_total!,order.currency);
 if(chargedMinor===0){
  // Stripe 的零元完成訂單也可能回傳 paid；前面已核對完成狀態、小計及全額折扣。
  if(!allowsDiscounts||session.payment_intent!==null)throw new Error('ORDER_PAYMENT_MISMATCH');
  return settleOrder(db,{orderId:id,sessionId:session.id,paymentIntentId:null,amountMinor:order.amount_minor,chargedMinor:0,currency:order.currency},now);
 }
 if(session.payment_status!=='paid')throw new Error('ORDER_PAYMENT_MISMATCH');
 const paymentIntentId=refId(session.payment_intent);if(!paymentIntentId)throw new Error("ORDER_PAYMENT_MISMATCH");
 const intent=intentSchema.parse(await gateway.retrievePaymentIntent(paymentIntentId));
 if(intent.status!=='succeeded'||intent.metadata.keydrop_order_id!==id||intent.amount_received!==session.amount_total||intent.currency!==session.currency)throw new Error("ORDER_PAYMENT_MISMATCH");
 const refundedMinor=fromStripeAmount(await gateway.succeededRefundAmount(paymentIntentId),order.currency);
 const result=await settleOrder(db,{orderId:id,sessionId:session.id,paymentIntentId,amountMinor:order.amount_minor,chargedMinor,currency:order.currency,refundedMinor},now);
 if(result.status==='refund_pending'){
  // Stripe 冪等鍵避免重試建立兩筆退款；退款尚未成功時不標記為 refunded。
  const refund=z.object({status:z.string().nullable()}).parse(await gateway.createRefund(paymentIntentId,id));
  if(refund.status==='failed'||refund.status==='canceled')await db.prepare("UPDATE orders SET review_required=1 WHERE id=?").bind(id).run();
  const confirmed=fromStripeAmount(await gateway.succeededRefundAmount(paymentIntentId),order.currency);
  if(confirmed>result.refunded_minor)return settleOrder(db,{orderId:id,sessionId:session.id,paymentIntentId,amountMinor:order.amount_minor,chargedMinor,currency:order.currency,refundedMinor:confirmed},now);
 }
 return result;
}
export async function processStripeEvent(db:D1Database,gateway:StripeGateway,event:Stripe.Event,now=Date.now()){
 const object=z.object({id:z.string()}).parse(event.data.object);
 const hash=await fingerprint(JSON.stringify({id:event.id,type:event.type,object:object.id,livemode:event.livemode,account:event.account??null}));
 const leaseToken=crypto.randomUUID();
 const existing=await db.prepare("SELECT payload_hash,status FROM stripe_events WHERE id=?").bind(event.id).first<{payload_hash:string;status:string}>();
 if(existing&&existing.payload_hash!==hash)throw new Error("STRIPE_EVENT_CONFLICT");if(existing?.status==='processed')return {duplicate:true};
 const leased=await db.prepare(`INSERT INTO stripe_events(id,type,payload_hash,status,lease_token,lease_until,created_at) VALUES(?,?,?,'processing',?,?,?)
 ON CONFLICT(id) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,attempts=stripe_events.attempts+1 WHERE stripe_events.status!='processed' AND stripe_events.lease_until<=? AND stripe_events.payload_hash=excluded.payload_hash RETURNING id`)
 .bind(event.id,event.type,hash,leaseToken,now+300000,now,now).first();
 if(!leased)throw new Error("STRIPE_EVENT_BUSY");
 try{
  if(["checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed","checkout.session.expired"].includes(event.type)){
   const order=await reconcileCheckout(db,gateway,object.id,now);
   // 非同步付款失敗：Session 仍是 complete／unpaid，需要依已驗簽的事件類型釋放預留。
   if(event.type==='checkout.session.async_payment_failed'&&order&&order.paid_at===null)await db.prepare("UPDATE orders SET status='expired',updated_at=? WHERE id=? AND status='pending' AND paid_at IS NULL").bind(now,order.id).run();
  }else if(["charge.refunded","refund.created","refund.updated","refund.failed"].includes(event.type)){
   const payment=z.object({payment_intent:reference}).parse(event.type==='charge.refunded'?await gateway.retrieveCharge(object.id):await gateway.retrieveRefund(object.id));
   const intentId=refId(payment.payment_intent);
   if(intentId){const intent=intentSchema.parse(await gateway.retrievePaymentIntent(intentId));const orderId=intent.metadata.keydrop_order_id;if(orderId){const order=await getOrder(db,orderId);if(!order?.checkout_session_id)throw new Error("ORDER_REFUND_UNMATCHED");await reconcileCheckout(db,gateway,order.checkout_session_id,now);}}
  }
  await db.prepare("UPDATE stripe_events SET status='processed',processed_at=?,lease_until=0 WHERE id=? AND lease_token=?").bind(now,event.id,leaseToken).run();return {duplicate:false};
 }catch(error){await db.prepare("UPDATE stripe_events SET lease_until=0 WHERE id=? AND status='processing' AND lease_token=?").bind(event.id,leaseToken).run();throw error;}
}
export async function verifyStripeEvent(client:Stripe,payload:string,signature:string|null,secret:string){
 if(!signature)throw new Error("STRIPE_SIGNATURE_INVALID");
 try{return await client.webhooks.constructEventAsync(payload,signature,secret,300,Stripe.createSubtleCryptoProvider());}catch{throw new Error("STRIPE_SIGNATURE_INVALID");}
}
