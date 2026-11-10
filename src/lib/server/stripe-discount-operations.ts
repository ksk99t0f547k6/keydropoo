import {z} from 'zod';
import {encryptionKey,fingerprint,openCode,sealCode} from '../domain/codes';
import {stripeCatalogKey} from './stripe-discount-catalog';
import {stripeCouponCreate,stripePromotionCreate,stripeCouponSnapshot,stripePromotionSnapshot,type stripeDiscountGateway} from './stripe-discounts';
const requestInput=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('coupon'),input:stripeCouponCreate}).strict(),
 z.object({kind:z.literal('promotion_code'),input:stripePromotionCreate}).strict(),
]);
const scopeInput=stripeCatalogKey.pick({accountId:true,livemode:true}).strict();
type Scope=z.infer<typeof scopeInput>;
type Gateway=Pick<ReturnType<typeof stripeDiscountGateway>,'createCoupon'|'createPromotion'>;
interface Operation {id:string;account_id:string;livemode:number;kind:string;request_hash:string;request_ciphertext:string;state:string;source_id:string|null;first_attempt_at:number|null;}
const retryWindow=23*60*60*1000;
function canonical(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
 return JSON.stringify(value);
}
function context(id:string,scope:Scope){return JSON.stringify(['stripe-create',id,scope.accountId,scope.livemode]);}
// 此入口只接收由伺服器確認的 Stripe 帳戶／模式，不可直接信任用戶端所填的 scope。
export async function createStripeDiscount(db:D1Database,secret:string,gateway:Gateway,scopeRaw:unknown,id:string,raw:unknown,now=Date.now()){
 z.uuid().parse(id);const scope=scopeInput.parse(scopeRaw),input=requestInput.parse(raw),key=await encryptionKey(secret);
 const serialized=canonical(input),hash=await fingerprint(serialized);
 const sealed=await sealCode(serialized,key,context(id,scope));
 await db.prepare(`INSERT INTO stripe_discount_operations(id,account_id,livemode,kind,request_hash,request_ciphertext,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
 .bind(id,scope.accountId,Number(scope.livemode),input.kind,hash,sealed,now,now).run();
 const row=await db.prepare('SELECT * FROM stripe_discount_operations WHERE id=?').bind(id).first<Operation>();
 if(!row||row.account_id!==scope.accountId||Boolean(row.livemode)!==scope.livemode||row.request_hash!==hash||row.kind!==input.kind)throw new Error('STRIPE_OPERATION_CONFLICT');
 if(row.state==='applied')return {operationId:id,sourceId:row.source_id!};
 // 超過安全期限不再呼叫建立 API；保留原操作供人工核對，不能換鍵盲目補送。
 if(row.state==='review'||(row.first_attempt_at!==null&&now-row.first_attempt_at>=retryWindow)){
  await db.prepare("UPDATE stripe_discount_operations SET state='review',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state!='applied'").bind(now,id).run();
  throw new Error('STRIPE_OPERATION_REVIEW_REQUIRED');
 }
 const lease=crypto.randomUUID();
 const locked=await db.prepare(`UPDATE stripe_discount_operations SET state='sending',lease_token=?,lease_until=?,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),updated_at=?
 WHERE id=? AND (first_attempt_at IS NULL OR first_attempt_at>?) AND (state IN('ready','retryable') OR (state='sending' AND lease_until<=?))`)
 .bind(lease,now+60000,now,now,id,now-retryWindow,now).run();
 if(!locked.meta.changes)throw new Error('STRIPE_OPERATION_BUSY');
 try{
  const saved=requestInput.parse(JSON.parse(await openCode(row.request_ciphertext,key,context(id,scope))));
  const result=saved.kind==='coupon'?stripeCouponSnapshot.parse(await gateway.createCoupon(id,saved.input)):stripePromotionSnapshot.parse(await gateway.createPromotion(id,saved.input));
  if(result.livemode!==scope.livemode)throw new Error('STRIPE_DISCOUNT_MISMATCH');
  if(saved.kind==='coupon'&&result.id!==`kd_${id.replaceAll('-','')}`)throw new Error('STRIPE_DISCOUNT_MISMATCH');
  if(saved.kind==='promotion_code'&&(result.object!=='promotion_code'||result.promotion.coupon!==saved.input.couponId||result.code.toLowerCase()!==saved.input.code.toLowerCase()))throw new Error('STRIPE_DISCOUNT_MISMATCH');
  const stored=await db.prepare("UPDATE stripe_discount_operations SET state='applied',source_id=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state='sending' AND lease_token=?")
  .bind(result.id,Date.now(),id,lease).run();
  if(!stored.meta.changes)throw new Error('STRIPE_OPERATION_BUSY');
  return {operationId:id,sourceId:result.id};
 }catch{
  await db.prepare("UPDATE stripe_discount_operations SET state='retryable',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state='sending' AND lease_token=?").bind(Date.now(),id,lease).run();
  throw new Error('STRIPE_OPERATION_FAILED');
 }
}

async function scopedOperation(db:D1Database,scope:Scope,id:string){
 z.uuid().parse(id);const row=await db.prepare('SELECT * FROM stripe_discount_operations WHERE id=? AND account_id=? AND livemode=?').bind(id,scope.accountId,Number(scope.livemode)).first<Operation>();
 if(!row)throw new Error('STRIPE_OPERATION_NOT_FOUND');return row;
}
export async function resumeStripeDiscount(db:D1Database,secret:string,gateway:Gateway,scopeRaw:unknown,id:string,now=Date.now()){
 const scope=scopeInput.parse(scopeRaw),row=await scopedOperation(db,scope,id);
 if(row.state==='applied')return {operationId:id,sourceId:row.source_id!};
 const input=requestInput.parse(JSON.parse(await openCode(row.request_ciphertext,await encryptionKey(secret),context(id,scope))));
 return createStripeDiscount(db,secret,gateway,scope,id,input,now);
}
export async function listStripeDiscountOperations(db:D1Database,scopeRaw:unknown,page=1){
 const scope=scopeInput.parse(scopeRaw);z.number().int().min(1).max(100000).parse(page);
 const {results}=await db.prepare(`SELECT id,kind,state,source_id,attempts,first_attempt_at,updated_at FROM stripe_discount_operations
 WHERE account_id=? AND livemode=? ORDER BY created_at DESC,id LIMIT 26 OFFSET ?`).bind(scope.accountId,Number(scope.livemode),(page-1)*25).all<{id:string;kind:'coupon'|'promotion_code';state:string;source_id:string|null;attempts:number;first_attempt_at:number|null;updated_at:number}>();
 return {items:results.slice(0,25),hasMore:results.length>25};
}
// 復原只讀取已存在的 Stripe 物件；必須匹配操作 metadata 與原請求，不以人工聲明取代核對。
export async function recoverStripeDiscount(db:D1Database,secret:string,gateway:Pick<ReturnType<typeof stripeDiscountGateway>,'recoveryCoupon'|'recoveryPromotion'>,scopeRaw:unknown,id:string,sourceId:string,now=Date.now()){
 const scope=scopeInput.parse(scopeRaw);stripeCatalogKey.shape.sourceId.parse(sourceId);
 const row=await scopedOperation(db,scope,id);
 if(row.state==='applied'){if(row.source_id!==sourceId)throw new Error('STRIPE_OPERATION_CONFLICT');return {operationId:id,sourceId};}
 if(row.first_attempt_at===null)throw new Error('STRIPE_OPERATION_RECOVERY_MISMATCH');
 const input=requestInput.parse(JSON.parse(await openCode(row.request_ciphertext,await encryptionKey(secret),context(id,scope))));
 if(input.kind==='coupon'&&sourceId!==`kd_${id.replaceAll('-','')}`)throw new Error('STRIPE_OPERATION_RECOVERY_MISMATCH');
 const lease=crypto.randomUUID();
 const locked=await db.prepare(`UPDATE stripe_discount_operations SET state='sending',lease_token=?,lease_until=?,updated_at=? WHERE id=? AND (state IN('retryable','review') OR (state='sending' AND lease_until<=?))`).bind(lease,now+60000,now,id,now).run();
 if(!locked.meta.changes)throw new Error('STRIPE_OPERATION_BUSY');
 try{
  const remote=input.kind==='coupon'?await gateway.recoveryCoupon(sourceId):await gateway.recoveryPromotion(sourceId),snapshot=remote.snapshot;
  if(remote.operationId!==id||snapshot.id!==sourceId||snapshot.livemode!==scope.livemode)throw new Error('STRIPE_OPERATION_RECOVERY_MISMATCH');
  if(input.kind==='promotion_code'&&(snapshot.object!=='promotion_code'||snapshot.promotion.coupon!==input.input.couponId||snapshot.code.toLowerCase()!==input.input.code.toLowerCase()))throw new Error('STRIPE_OPERATION_RECOVERY_MISMATCH');
  const updated=await db.prepare("UPDATE stripe_discount_operations SET state='applied',source_id=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state='sending' AND lease_token=?").bind(sourceId,Date.now(),id,lease).run();
  if(!updated.meta.changes)throw new Error('STRIPE_OPERATION_BUSY');return {operationId:id,sourceId};
 }catch{
  await db.prepare("UPDATE stripe_discount_operations SET state=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state='sending' AND lease_token=?").bind(now-row.first_attempt_at>=retryWindow?'review':'retryable',Date.now(),id,lease).run();
  throw new Error('STRIPE_OPERATION_RECOVERY_FAILED');
 }
}
