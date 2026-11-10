import {z} from 'zod';
import {encryptionKey,openCode,sealCode,fingerprint} from '../domain/codes';
import {StripeDiscountMissingError,stripeCouponSnapshot,stripePromotionSnapshot,type stripeDiscountGateway} from './stripe-discounts';
export const stripeCatalogKey=z.object({accountId:z.string().regex(/^acct_[A-Za-z0-9]+$/),livemode:z.boolean(),kind:z.enum(['coupon','promotion_code']),sourceId:z.string().min(1).max(255).refine(value=>!/[\u0000-\u001f\u007f]/.test(value))}).strict();
export type StripeCatalogKey=z.infer<typeof stripeCatalogKey>;
type Gateway=Pick<ReturnType<typeof stripeDiscountGateway>,'retrieveCoupon'|'retrievePromotion'>;
function args(key:StripeCatalogKey){return [key.accountId,Number(key.livemode),key.kind,key.sourceId] as const;}
function context(key:StripeCatalogKey,version:number){return JSON.stringify(['stripe-discount',...args(key),version]);}
const where='account_id=? AND livemode=? AND kind=? AND source_id=?';
interface CatalogRow {request_version:number;stored_version:number;ciphertext:string|null;deleted:number;active:number|null;last_error:string|null;synced_at:number|null;}

// 先取得版本再查 Stripe；晚到的結果只可寫回自己取得的版本。
export async function pullStripeDiscount(db:D1Database,secret:string,gateway:Gateway,raw:unknown,now=Date.now()){
 const key=stripeCatalogKey.parse(raw),cipherKey=await encryptionKey(secret);
 const ticket=await db.prepare(`INSERT INTO stripe_discount_catalog(account_id,livemode,kind,source_id,request_version,requested_at)
 VALUES(?,?,?,?,1,?) ON CONFLICT(account_id,livemode,kind,source_id) DO UPDATE SET request_version=request_version+1,requested_at=excluded.requested_at,last_error=NULL
 RETURNING request_version`).bind(...args(key),now).first<{request_version:number}>();
 if(!ticket)throw new Error('STRIPE_SYNC_UNAVAILABLE');
 const version=ticket.request_version;
 try{
  let snapshot,deleted=false;
  try{snapshot=key.kind==='coupon'?stripeCouponSnapshot.parse(await gateway.retrieveCoupon(key.sourceId)):stripePromotionSnapshot.parse(await gateway.retrievePromotion(key.sourceId));}
  catch(error){if(!(error instanceof StripeDiscountMissingError))throw error;deleted=true;}
  if(snapshot&&(snapshot.id!==key.sourceId||snapshot.livemode!==key.livemode))throw new Error('STRIPE_DISCOUNT_MISMATCH');
  const ciphertext=snapshot?await sealCode(JSON.stringify(snapshot),cipherKey,context(key,version)):null;
  const active=snapshot?Number(snapshot.object==='coupon'?snapshot.valid:snapshot.active):0;
  const expires=snapshot?(snapshot.object==='coupon'?snapshot.redeem_by:snapshot.expires_at):null;
  const parent=snapshot?.object==='promotion_code'?snapshot.promotion.coupon:null;
  const codeHash=snapshot?.object==='promotion_code'?await fingerprint(snapshot.code):null;
  const result=await db.prepare(`UPDATE stripe_discount_catalog SET expires_at=?,parent_id=?,code_fingerprint=?,stored_version=?,ciphertext=?,active=?,deleted=?,synced_at=?,last_error=NULL WHERE ${where} AND request_version=?`)
   .bind(expires===null?null:expires*1000,parent,codeHash,version,ciphertext,active,Number(deleted),Date.now(),...args(key),version).run();
  return {stored:Boolean(result.meta.changes),version,deleted};
 }catch{
  // Stripe 的錯誤可能帶請求內容，不將其寫進資料庫或直接顯示。
  await db.prepare(`UPDATE stripe_discount_catalog SET last_error='STRIPE_SYNC_FAILED' WHERE ${where} AND request_version=?`).bind(...args(key),version).run();
  throw new Error('STRIPE_SYNC_FAILED');
 }
}
export async function readStripeDiscount(db:D1Database,secret:string,raw:unknown){
 const key=stripeCatalogKey.parse(raw);
 const row=await db.prepare(`SELECT request_version,stored_version,ciphertext,deleted,active,last_error,synced_at FROM stripe_discount_catalog WHERE ${where}`).bind(...args(key)).first<CatalogRow>();
 if(!row)return null;
 const snapshot=row.ciphertext?JSON.parse(await openCode(row.ciphertext,await encryptionKey(secret),context(key,row.stored_version))):null;
 const value=snapshot?(key.kind==='coupon'?stripeCouponSnapshot.parse(snapshot):stripePromotionSnapshot.parse(snapshot)):null;
 return {key,version:row.stored_version,fresh:row.stored_version===row.request_version&&row.last_error===null,deleted:Boolean(row.deleted),snapshot:value,syncedAt:row.synced_at,error:row.last_error};
}
export async function listStripeDiscounts(db:D1Database,raw:unknown){
 const input=stripeCatalogKey.omit({sourceId:true}).extend({page:z.number().int().min(1).max(100000).default(1)}).parse(raw);
 const {results}=await db.prepare(`SELECT source_id,request_version,stored_version,active,deleted,synced_at,last_error FROM stripe_discount_catalog WHERE account_id=? AND livemode=? AND kind=? ORDER BY source_id LIMIT 26 OFFSET ?`)
 .bind(input.accountId,Number(input.livemode),input.kind,(input.page-1)*25).all<{source_id:string;request_version:number;stored_version:number;active:number|null;deleted:number;synced_at:number|null;last_error:string|null}>();
 return {items:results.slice(0,25),hasMore:results.length>25};
}
