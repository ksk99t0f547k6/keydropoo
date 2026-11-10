import {z} from 'zod';
import {encryptionKey,fingerprint,sealCode} from '../domain/codes';
import {stripeCatalogKey,readStripeDiscount} from './stripe-discount-catalog';
export const stripeInventoryInput=z.object({productId:z.uuid(),promotionId:stripeCatalogKey.shape.sourceId,name:z.string().trim().min(1).max(120),distributionMode:z.enum(['unique','shared']).default('shared'),sharedClaimLimit:z.number().int().min(1).max(1000000).nullable().default(null)}).strict();
export async function importStripePromotion(db:D1Database,secret:string,scopeRaw:unknown,raw:unknown,now=Date.now()){
 const scope=stripeCatalogKey.pick({accountId:true,livemode:true}).parse(scopeRaw),input=stripeInventoryInput.parse(raw);
 const hash=await fingerprint(JSON.stringify(input));
 async function replay(){
  const row=await db.prepare(`SELECT l.code_id,c.batch_id,l.import_hash FROM stripe_inventory_links l JOIN codes c ON c.id=l.code_id WHERE l.account_id=? AND l.livemode=? AND l.promotion_id=? AND l.product_id=?`).bind(scope.accountId,Number(scope.livemode),input.promotionId,input.productId).first<{code_id:string;batch_id:string;import_hash:string}>();
  if(row&&row.import_hash!==hash)throw new Error('STRIPE_INVENTORY_CONFLICT');return row?{codeId:row.code_id,batchId:row.batch_id}:null;
 }
 const previous=await replay();if(previous)return previous;
 const promo=await readStripeDiscount(db,secret,{...scope,kind:'promotion_code',sourceId:input.promotionId});
 if(!promo?.fresh||promo.deleted||promo.snapshot?.object!=='promotion_code'||!promo.snapshot.active)throw new Error('STRIPE_INVENTORY_UNAVAILABLE');
 const couponId=promo.snapshot.promotion.coupon;
 const coupon=await readStripeDiscount(db,secret,{...scope,kind:'coupon',sourceId:couponId});
 if(!coupon?.fresh||coupon.deleted||coupon.snapshot?.object!=='coupon'||!coupon.snapshot.valid)throw new Error('STRIPE_INVENTORY_UNAVAILABLE');
 const key=await encryptionKey(secret),codeId=crypto.randomUUID(),batchId=crypto.randomUUID(),codeHash=await fingerprint(promo.snapshot.code),ciphertext=await sealCode(promo.snapshot.code,key,`${input.productId}:${codeId}`);
 try{await db.batch([
  db.prepare(`INSERT INTO code_batches(id,product_id,name,kind,source,created_at,distribution_mode,shared_claim_limit) VALUES(?,?,?,'discount','stripe',?,?,?)`).bind(batchId,input.productId,input.name,now,input.distributionMode,input.sharedClaimLimit),
  db.prepare('INSERT INTO codes(id,product_id,batch_id,fingerprint,ciphertext,created_at) VALUES(?,?,?,?,?,?)').bind(codeId,input.productId,batchId,codeHash,ciphertext,now),
  db.prepare(`INSERT INTO stripe_inventory_links(code_id,product_id,account_id,livemode,promotion_id,coupon_id,promotion_version,coupon_version,source_fingerprint,import_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(codeId,input.productId,scope.accountId,Number(scope.livemode),input.promotionId,couponId,promo.version,coupon.version,codeHash,hash,now),
 ]);}catch(error){const existing=await replay();if(existing)return existing;if(error instanceof Error&&error.message.includes('STRIPE_INVENTORY_UNAVAILABLE'))throw new Error('STRIPE_INVENTORY_UNAVAILABLE');if(error instanceof Error&&error.message.includes('codes.product_id, codes.fingerprint'))throw new Error('DUPLICATE_CODES');throw error;}
 return {codeId,batchId};
}
