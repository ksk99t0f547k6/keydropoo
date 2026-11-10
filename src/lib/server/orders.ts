import {z} from "zod";
import {encryptionKey,openCode} from "../domain/codes";
export interface OrderRow {
 id:string;product_id:string;batch_id:string;buyer_key:string;user_id:string|null;email:string|null;idempotency_key:string;
 amount_minor:number;charged_minor:number|null;currency:string;shortage_policy:"refund"|"manual"|"backorder";revoke_on_refund:number;
 status:"pending"|"expired"|"fulfilled"|"refund_pending"|"refunded"|"manual"|"backorder";
 reserved_code_id:string;code_id:string|null;reserved_until:number;checkout_session_id:string|null;payment_intent_id:string|null;
 refunded_minor:number;review_required:number;access_revoked_at:number|null;paid_at:number|null;created_at:number;updated_at:number;
}
export async function getOrder(db:D1Database,id:string){z.uuid().parse(id);return db.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<OrderRow>();}
// 每位買家／每個網段同時未付款的預留上限，避免匿名請求把整批庫存鎖住。
export const PENDING_ORDERS_PER_BUYER=2;
export const PENDING_ORDERS_PER_NETWORK=5;
// 沒有 Stripe Session 的預留只保留 35 分鐘；Session 建立後的延長規則見 attachCheckout。
export const RESERVATION_MS=35*60000;
// Session 到期後再保留的時間，涵蓋 Stripe Webhook 最長約 3 天的重試；
// 正常情況會在收到 checkout.session.expired 時立即釋放。
export const WEBHOOK_GRACE_MS=3*86400000;
// 非同步付款（例如銀行轉帳）完成 Session 後仍未入帳，最長保留 14 天等待結果。
export const ASYNC_PAYMENT_HOLD_MS=14*86400000;
export async function expireReservations(db:D1Database,now=Date.now()){
 // 釋放預留會連帶更新碼庫，計數只包含直接到期的訂單。
 const {results}=await db.prepare("UPDATE orders SET status='expired',updated_at=? WHERE status='pending' AND paid_at IS NULL AND reserved_until<=? RETURNING id").bind(now,now).all<{id:string}>();return {expired:results.length};
}
const reserveInput=z.object({productId:z.uuid(),batchId:z.uuid(),buyerKey:z.string().min(1).max(200),ipKey:z.string().min(1).max(200).nullable().default(null),userId:z.string().min(1).max(128).nullable().default(null),email:z.email().nullable().default(null),idempotencyKey:z.uuid()}).strict();
export async function reserveOrder(db:D1Database,raw:unknown,now=Date.now()){
 const input=reserveInput.parse(raw);
 async function existing(){return db.prepare("SELECT * FROM orders WHERE buyer_key=? AND idempotency_key=?").bind(input.buyerKey,input.idempotencyKey).first<OrderRow>();}
 function replay(row:OrderRow){if(row.product_id!==input.productId||row.batch_id!==input.batchId||row.user_id!==input.userId||row.email!==input.email)throw new Error("ORDER_IDEMPOTENCY_CONFLICT");return row;}
 const previous=await existing();if(previous)return replay(previous);
 await expireReservations(db,now);
 const id=crypto.randomUUID();
 try{
  const result=await db.prepare(`INSERT INTO orders(id,product_id,batch_id,buyer_key,ip_key,user_id,email,idempotency_key,amount_minor,currency,shortage_policy,revoke_on_refund,reserved_code_id,reserved_until,created_at,updated_at)
  SELECT ?,p.id,b.id,?,?,?,?,?,p.price_minor,p.currency,p.shortage_policy,p.revoke_on_refund,c.id,?,?,?
  FROM products p JOIN code_batches b ON b.product_id=p.id JOIN codes c ON c.batch_id=b.id
  WHERE p.id=? AND b.id=? AND p.archived_at IS NULL AND p.price_minor>0
  AND (SELECT count(*) FROM orders x WHERE x.buyer_key=? AND x.status='pending' AND x.paid_at IS NULL AND x.created_at>?)<?
  AND (? IS NULL OR (SELECT count(*) FROM orders x WHERE x.ip_key=? AND x.status='pending' AND x.paid_at IS NULL AND x.created_at>?)<?) AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id) AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=c.id AND a.state!='applied') AND c.status='available') OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>?))<b.shared_claim_limit))) AND (c.expires_at IS NULL OR c.expires_at>?)
  ORDER BY c.created_at,c.id LIMIT 1`)
  .bind(id,input.buyerKey,input.ipKey,input.userId,input.email,input.idempotencyKey,now+RESERVATION_MS,now,now,input.productId,input.batchId,
   input.buyerKey,now-RESERVATION_MS,PENDING_ORDERS_PER_BUYER,input.ipKey,input.ipKey,now-RESERVATION_MS,PENDING_ORDERS_PER_NETWORK,now,now).run();
  if(!result.meta.changes){
   // 沒插入時分辨是未付款預留過多還是真的缺貨，前端顯示不同訊息。
   const pending=await db.prepare("SELECT (SELECT count(*) FROM orders WHERE buyer_key=? AND status='pending' AND paid_at IS NULL AND created_at>?) AS buyer,(SELECT count(*) FROM orders WHERE ? IS NOT NULL AND ip_key=? AND status='pending' AND paid_at IS NULL AND created_at>?) AS network")
    .bind(input.buyerKey,now-RESERVATION_MS,input.ipKey,input.ipKey,now-RESERVATION_MS).first<{buyer:number;network:number}>();
   if(pending&&(pending.buyer>=PENDING_ORDERS_PER_BUYER||pending.network>=PENDING_ORDERS_PER_NETWORK))throw new Error("ORDER_PENDING_LIMIT");
   throw new Error("ORDER_STOCK_UNAVAILABLE");
  }
 }catch(error){const replayed=await existing();if(replayed)return replay(replayed);throw error;}
 return (await getOrder(db,id))!;
}
export async function attachCheckout(db:D1Database,id:string,sessionId:string){
 z.uuid().parse(id);z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(255).parse(sessionId);
 // 有 Session 後，預留延長到「Session 到期＋Webhook 寬限」：買家在最後一分鐘付款或 Webhook 晚到時，
 // 碼不會先被排程釋放給別人。放棄付款的訂單仍會在 checkout.session.expired 時立即釋放。
 // SET 讀到的是更新前的 checkout_session_id，重複附加同一個 Session 不會再延長。
 const result=await db.prepare("UPDATE orders SET checkout_session_id=?,reserved_until=CASE WHEN checkout_session_id IS NULL AND status='pending' AND paid_at IS NULL THEN reserved_until+? ELSE reserved_until END WHERE id=? AND (checkout_session_id IS NULL OR checkout_session_id=?)").bind(sessionId,WEBHOOK_GRACE_MS,id,sessionId).run();
 if(!result.meta.changes)throw new Error("ORDER_SESSION_CONFLICT");
}
const paymentInput=z.object({orderId:z.uuid(),sessionId:z.string().min(1).max(255),paymentIntentId:z.string().min(1).max(255).nullable(),chargedMinor:z.number().int().nonnegative().optional(),amountMinor:z.number().int().positive(),currency:z.string().regex(/^[A-Z]{3}$/),refundedMinor:z.number().int().min(0).default(0)}).strict().refine(v=>{const charged=v.chargedMinor??v.amountMinor;return charged<=v.amountMinor&&v.refundedMinor<=charged&&(charged===0?v.paymentIntentId===null:v.paymentIntentId!==null);});
// 僅由已驗簽且核對過 Stripe 狀態的伺服器整合呼叫，不接受公開頁面宣稱已付款。
export async function settleOrder(db:D1Database,raw:unknown,now=Date.now()){
 const input=paymentInput.parse(raw);
 const result=await db.prepare(`UPDATE orders SET paid_at=COALESCE(paid_at,?),charged_minor=?,payment_intent_id=?,refunded_minor=MAX(refunded_minor,?),updated_at=?
 WHERE id=? AND checkout_session_id=? AND amount_minor=? AND currency=? AND (paid_at IS NULL OR (payment_intent_id IS ? AND charged_minor=?))`)
 .bind(now,input.chargedMinor??input.amountMinor,input.paymentIntentId,input.refundedMinor,now,input.orderId,input.sessionId,input.amountMinor,input.currency,input.paymentIntentId,input.chargedMinor??input.amountMinor).run();
 if(!result.meta.changes)throw new Error("ORDER_PAYMENT_MISMATCH");return (await getOrder(db,input.orderId))!;
}
export async function refundOrder(db:D1Database,paymentIntentId:string,refundedMinor:number,now=Date.now()){
 z.string().min(1).max(255).parse(paymentIntentId);z.number().int().min(0).parse(refundedMinor);
 const result=await db.prepare("UPDATE orders SET refunded_minor=MAX(refunded_minor,?),updated_at=? WHERE payment_intent_id=? AND paid_at IS NOT NULL AND charged_minor>=?").bind(refundedMinor,now,paymentIntentId,refundedMinor).run();
 if(!result.meta.changes)throw new Error("ORDER_REFUND_UNMATCHED");
 return (await db.prepare("SELECT * FROM orders WHERE payment_intent_id=?").bind(paymentIntentId).first<OrderRow>())!;
}
export async function fulfillWaitingOrder(db:D1Database,id:string,manual=false,now=Date.now()){
 z.uuid().parse(id);
 await db.batch([db.prepare(`UPDATE orders SET code_id=(SELECT c.id FROM codes c JOIN products p ON p.id=c.product_id JOIN code_batches b ON b.id=c.batch_id WHERE c.product_id=orders.product_id AND c.batch_id=orders.batch_id AND p.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id) AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=c.id AND a.state!='applied') AND c.status='available') OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>?))<b.shared_claim_limit))) AND (c.expires_at IS NULL OR c.expires_at>?) ORDER BY c.created_at,c.id LIMIT 1),updated_at=?
 WHERE id=? AND status IN ('backorder',?) AND paid_at IS NOT NULL AND (charged_minor=0 OR refunded_minor<charged_minor) AND code_id IS NULL`).bind(now,now,now,id,manual?"manual":"backorder"),
 db.prepare("UPDATE orders SET status='fulfilled' WHERE id=? AND status IN ('backorder','manual') AND code_id IS NOT NULL").bind(id)]);
 return getOrder(db,id);
}
export async function purchasedOrderCount(db:D1Database,userId:string,productId:string){
 z.string().min(1).max(128).parse(userId);z.uuid().parse(productId);
 return (await db.prepare("SELECT count(*) AS total FROM orders WHERE user_id=? AND product_id=? AND paid_at IS NOT NULL AND (charged_minor=0 OR refunded_minor<charged_minor)").bind(userId,productId).first<{total:number}>())?.total??0;
}
export async function deliverOrder(db:D1Database,secret:string,id:string,buyerKey:string){
 const order=await getOrder(db,id);if(!order||order.buyer_key!==buyerKey)throw new Error("ORDER_NOT_FOUND");
 let code:string|null=null;
 if(['fulfilled','refunded'].includes(order.status)&&order.code_id&&order.access_revoked_at===null){const row=await db.prepare("SELECT ciphertext FROM codes WHERE id=? AND status!='revoked'").bind(order.code_id).first<{ciphertext:string}>();if(row)code=await openCode(row.ciphertext,await encryptionKey(secret),`${order.product_id}:${order.code_id}`);}
 return {linked:order.user_id!==null,canLink:order.user_id===null&&order.paid_at!==null,id:order.id,productId:order.product_id,status:order.status,amountMinor:order.charged_minor??order.amount_minor,listAmountMinor:order.amount_minor,currency:order.currency,refundedMinor:order.refunded_minor,code};
}

export async function linkGuestOrder(db:D1Database,id:string,browserKey:string,userId:string,userKey:string){
 z.uuid().parse(id);z.string().min(1).max(128).parse(userId);
 const previous=await getOrder(db,id);
 if(previous?.user_id===userId&&previous.buyer_key===userKey)return {linked:true};
 const result=await db.prepare(`UPDATE orders SET user_id=?,buyer_key=?,updated_at=?
 WHERE id=? AND user_id IS NULL AND buyer_key=? AND paid_at IS NOT NULL AND EXISTS(SELECT 1 FROM "user" WHERE id=?)`)
 .bind(userId,userKey,Date.now(),id,browserKey,userId).run();
 if(!result.meta.changes){const replay=await getOrder(db,id);if(replay?.user_id===userId&&replay.buyer_key===userKey)return {linked:true};throw new Error("ORDER_LINK_UNAVAILABLE");}
 return {linked:true};
}
export const orderStatuses=["pending","expired","fulfilled","refund_pending","refunded","manual","backorder"] as const;
export async function listOrders(db:D1Database,raw:unknown){
 const input=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),status:z.enum(orderStatuses).optional(),productId:z.uuid().optional()}).strict().parse(raw);
 const clauses:string[]=[],args:string[]=[];
 if(input.status){clauses.push("o.status=?");args.push(input.status);}if(input.productId){clauses.push("o.product_id=?");args.push(input.productId);}
 const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:"";
 const count=await db.prepare(`SELECT count(*) AS total FROM orders o ${where}`).bind(...args).first<{total:number}>();
 const {results}=await db.prepare(`SELECT o.id,o.product_id,p.name AS product_name,o.user_id,o.email,COALESCE(o.charged_minor,o.amount_minor) AS amount_minor,o.currency,o.status,o.refunded_minor,o.review_required,o.paid_at,o.created_at,o.reserved_until,o.code_id,o.access_revoked_at,b.kind AS code_kind,c.status AS code_status,
 (SELECT json_object('decision',r.decision,'note',r.note,'refundedMinor',r.refunded_minor,'createdAt',r.created_at,'adminId',r.admin_id) FROM order_refund_reviews r WHERE r.order_id=o.id ORDER BY r.refunded_minor DESC LIMIT 1) AS refund_review_json
 FROM orders o JOIN products p ON p.id=o.product_id JOIN code_batches b ON b.id=o.batch_id LEFT JOIN codes c ON c.id=o.code_id ${where} ORDER BY o.created_at DESC,o.id LIMIT 20 OFFSET ?`).bind(...args,(input.page-1)*20).all<{id:string;product_id:string;product_name:string;user_id:string|null;email:string|null;amount_minor:number;currency:string;status:OrderRow['status'];refunded_minor:number;review_required:number;access_revoked_at:number|null;paid_at:number|null;created_at:number;reserved_until:number;code_id:string|null;code_kind:string;code_status:string|null;refund_review_json:string|null}>();
 return {orders:results,total:count?.total??0,page:input.page,pageSize:20};
}
