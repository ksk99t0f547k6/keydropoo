import {z} from 'zod';
import {encryptionKey,fingerprint,openCode,sealCode} from '../domain/codes';
import {stripePromotionCreate,type stripeDiscountGateway} from './stripe-discounts';
import {stripeCatalogKey,pullStripeDiscount,readStripeDiscount} from './stripe-discount-catalog';
import {createStripeDiscount} from './stripe-discount-operations';
const {code:codeField,...promotionFields}=stripePromotionCreate.shape;void codeField;
export const stripeExportInput=z.object({
 productId:z.uuid(),codeId:z.uuid(),operationId:z.uuid(),
 promotion:z.object({...promotionFields,active:z.literal(true).default(true)}).strict(),
}).strict();
function context(codeId:string,operationId:string){return JSON.stringify(['stripe-export',codeId,operationId]);}
type Gateway=ReturnType<typeof stripeDiscountGateway>;
export async function exportStripePromotion(db:D1Database,secret:string,gateway:Gateway,scopeRaw:unknown,raw:unknown,now=Date.now()){
 const scope=stripeCatalogKey.pick({accountId:true,livemode:true}).parse(scopeRaw),input=stripeExportInput.parse(raw);
 const requestHash=await fingerprint(JSON.stringify(input));
 const code=await db.prepare(`SELECT c.id,c.batch_id,c.product_id,c.ciphertext,c.fingerprint,c.expires_at FROM codes c JOIN code_batches b ON b.id=c.batch_id WHERE c.id=? AND c.product_id=? AND b.kind='discount'`).bind(input.codeId,input.productId).first<{id:string;batch_id:string;product_id:string;ciphertext:string;fingerprint:string;expires_at:number|null}>();
 if(!code)throw new Error('STRIPE_INVENTORY_UNAVAILABLE');
 const value=await openCode(code.ciphertext,await encryptionKey(secret),`${input.productId}:${code.id}`);
 const promotion=stripePromotionCreate.parse({...input.promotion,code:value});
 // 同一次推送固定本機期限，Stripe 不得延長本機原有有效期。
 if(code.expires_at!==null)promotion.expiresAt=Math.min(promotion.expiresAt??Infinity,Math.floor(code.expires_at/1000));
 const prior=await db.prepare('SELECT * FROM stripe_inventory_exports WHERE code_id=?').bind(code.id).first<{operation_id:string;account_id:string;livemode:number;request_hash:string;original_expires_at:number|null}>();
 const validate=(row:typeof prior)=>{if(!row||row.operation_id!==input.operationId||row.account_id!==scope.accountId||Boolean(row.livemode)!==scope.livemode||row.request_hash!==requestHash)throw new Error('STRIPE_INVENTORY_CONFLICT');};
 if(prior){validate(prior);promotion.expiresAt=prior.original_expires_at===null?input.promotion.expiresAt:Math.min(input.promotion.expiresAt??Infinity,Math.floor(prior.original_expires_at/1000));}
 else{
  // 先確認 Coupon 可用，避免明確無效設定就鎖住本機庫存。
  await pullStripeDiscount(db,secret,gateway,{...scope,kind:'coupon',sourceId:promotion.couponId},now);
  const coupon=await readStripeDiscount(db,secret,{...scope,kind:'coupon',sourceId:promotion.couponId});
  if(!coupon?.fresh||coupon.snapshot?.object!=='coupon'||!coupon.snapshot.valid)throw new Error('STRIPE_INVENTORY_UNAVAILABLE');
  const sealed=await sealCode(JSON.stringify(input),await encryptionKey(secret),context(code.id,input.operationId));
  try{await db.prepare('INSERT INTO stripe_inventory_exports(code_id,product_id,operation_id,account_id,livemode,request_hash,request_ciphertext,original_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(code_id) DO NOTHING').bind(code.id,input.productId,input.operationId,scope.accountId,Number(scope.livemode),requestHash,sealed,code.expires_at,now).run();}
  catch{throw new Error('STRIPE_INVENTORY_CONFLICT');}
  validate(await db.prepare('SELECT * FROM stripe_inventory_exports WHERE code_id=?').bind(code.id).first());
 }
 const linked=await db.prepare('SELECT promotion_id FROM stripe_inventory_links WHERE code_id=?').bind(code.id).first<{promotion_id:string}>();
 if(linked)return {operationId:input.operationId,sourceId:linked.promotion_id,codeId:code.id,batchId:code.batch_id,linked:true};
 const created=await createStripeDiscount(db,secret,gateway,scope,input.operationId,{kind:'promotion_code',input:promotion},now);
 // 建立結果持久化後，來源同步／本機關聯失敗不改用新操作 ID。
 try{
  await pullStripeDiscount(db,secret,gateway,{...scope,kind:'promotion_code',sourceId:created.sourceId},now);
  await pullStripeDiscount(db,secret,gateway,{...scope,kind:'coupon',sourceId:promotion.couponId},now);
  const remote=await readStripeDiscount(db,secret,{...scope,kind:'promotion_code',sourceId:created.sourceId});
  const coupon=await readStripeDiscount(db,secret,{...scope,kind:'coupon',sourceId:promotion.couponId});
  if(!remote?.fresh||!coupon?.fresh)throw new Error('STRIPE_INVENTORY_UNAVAILABLE');
  await db.prepare(`INSERT INTO stripe_inventory_links(code_id,product_id,account_id,livemode,promotion_id,coupon_id,promotion_version,coupon_version,source_fingerprint,import_hash,created_at,original_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(code_id) DO NOTHING`)
   .bind(code.id,input.productId,scope.accountId,Number(scope.livemode),created.sourceId,promotion.couponId,remote.version,coupon.version,code.fingerprint,requestHash,now,prior?prior.original_expires_at:code.expires_at).run();
  const saved=await db.prepare('SELECT promotion_id FROM stripe_inventory_links WHERE code_id=?').bind(code.id).first<{promotion_id:string}>();
  if(saved?.promotion_id!==created.sourceId)throw new Error('STRIPE_INVENTORY_CONFLICT');
  return {...created,codeId:code.id,batchId:code.batch_id,linked:true};
 }catch{return {...created,codeId:code.id,batchId:code.batch_id,linked:false};}
}

export async function resumeStripeExport(db:D1Database,secret:string,gateway:Gateway,scopeRaw:unknown,productId:string,codeId:string){
 z.uuid().parse(productId);z.uuid().parse(codeId);
 const scope=stripeCatalogKey.pick({accountId:true,livemode:true}).parse(scopeRaw);
 const row=await db.prepare('SELECT operation_id,request_ciphertext FROM stripe_inventory_exports WHERE code_id=? AND product_id=? AND account_id=? AND livemode=?').bind(codeId,productId,scope.accountId,Number(scope.livemode)).first<{operation_id:string;request_ciphertext:string}>();
 if(!row)throw new Error('STRIPE_INVENTORY_UNAVAILABLE');
 const input=JSON.parse(await openCode(row.request_ciphertext,await encryptionKey(secret),context(codeId,row.operation_id)));
 return exportStripePromotion(db,secret,gateway,scope,input);
}
