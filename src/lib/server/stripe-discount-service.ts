import {exportStripePromotion,resumeStripeExport,stripeExportInput} from './stripe-inventory-export';
import {importStripePromotion,stripeInventoryInput} from './stripe-inventory';
import type Stripe from 'stripe';
import {z} from 'zod';
import {stripeClient} from './stripe';
import {stripeDiscountGateway,stripeCouponCreate,stripePromotionCreate} from './stripe-discounts';
import {stripeCatalogKey,pullStripeDiscount,listStripeDiscounts,readStripeDiscount} from './stripe-discount-catalog';
import {createStripeDiscount,resumeStripeDiscount,recoverStripeDiscount,listStripeDiscountOperations} from './stripe-discount-operations';
const scopeSchema=stripeCatalogKey.pick({accountId:true,livemode:true});
export type StripeDiscountScope=z.infer<typeof scopeSchema>;
const kind=z.enum(['coupon','promotion_code']),sourceId=stripeCatalogKey.shape.sourceId;
export const discountReadAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('connection')}).strict(),
 z.object({action:z.literal('operations'),page:z.number().int().min(1).max(100000).default(1)}).strict(),
 z.object({action:z.literal('catalog'),kind,page:z.number().int().min(1).max(100000).default(1)}).strict(),
 z.object({action:z.literal('discover'),kind,cursor:sourceId.optional()}).strict(),
 z.object({action:z.literal('read'),kind,sourceId}).strict(),
]);
export const discountWriteAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('resumeExport'),input:z.object({productId:z.uuid(),codeId:z.uuid()}).strict(),expectedScope:scopeSchema}).strict(),
 z.object({action:z.literal('exportPromotion'),input:stripeExportInput,expectedScope:scopeSchema}).strict(),
 z.object({action:z.literal('importPromotions'),input:stripeInventoryInput.omit({promotionId:true}).extend({promotionIds:z.array(sourceId).min(1).max(25).refine(ids=>new Set(ids).size===ids.length,'DUPLICATE_SOURCE_IDS')}).strict(),expectedScope:scopeSchema}).strict(),
 z.object({action:z.literal('importPromotion'),input:stripeInventoryInput,expectedScope:scopeSchema}).strict(),
 z.object({action:z.literal('resume'),operationId:z.uuid(),expectedScope:scopeSchema}).strict(),
 z.object({action:z.literal('recover'),operationId:z.uuid(),sourceId,expectedScope:scopeSchema}).strict(),
 z.object({action:z.literal('sync'),kind,sourceId,expectedScope:scopeSchema}).strict(),
 z.object({action:z.literal('createCoupon'),operationId:z.uuid(),input:stripeCouponCreate,expectedScope:scopeSchema}).strict(),
 z.object({action:z.literal('createPromotion'),operationId:z.uuid(),input:stripePromotionCreate,expectedScope:scopeSchema}).strict(),
]);
export const discountAction=z.discriminatedUnion('action',[...discountReadAction.options,...discountWriteAction.options]);
// 同一 client 的認證結果供後續折扣操作使用，不由密鑰字首或前端欄位推斷。
export async function stripeDiscountIdentity(client:Stripe):Promise<StripeDiscountScope>{
 try{
  const results=await Promise.all([client.accounts.retrieve(null),client.balance.retrieve()]);
  const account=z.object({object:z.literal('account'),id:scopeSchema.shape.accountId}).parse(results[0]);
  const balance=z.object({object:z.literal('balance'),livemode:z.boolean()}).parse(results[1]);
  return {accountId:account.id,livemode:balance.livemode};
 }catch{throw new Error('STRIPE_IDENTITY_UNAVAILABLE');}
}
export async function connectStripeDiscounts(secret:string|undefined,client?:Stripe){
 if(!secret)throw new Error('STRIPE_NOT_CONFIGURED');
 const connection=client??stripeClient(secret),scope=await stripeDiscountIdentity(connection);
 return {scope,gateway:stripeDiscountGateway(connection)};
}
export async function executeDiscountAction(db:D1Database,encryptionSecret:string,connection:Awaited<ReturnType<typeof connectStripeDiscounts>>,raw:unknown){
 const input=discountAction.parse(raw),{scope,gateway}=connection;
 if(input.action==='connection')return scope;
 if('expectedScope' in input&&(input.expectedScope.accountId!==scope.accountId||input.expectedScope.livemode!==scope.livemode))throw new Error('STRIPE_CONNECTION_CHANGED');
 async function importOne(item:z.infer<typeof stripeInventoryInput>){
  await pullStripeDiscount(db,encryptionSecret,gateway,{...scope,kind:'promotion_code',sourceId:item.promotionId});
  const promotion=await readStripeDiscount(db,encryptionSecret,{...scope,kind:'promotion_code',sourceId:item.promotionId});
  if(!promotion?.fresh||promotion.snapshot?.object!=='promotion_code')throw new Error('STRIPE_INVENTORY_UNAVAILABLE');
  await pullStripeDiscount(db,encryptionSecret,gateway,{...scope,kind:'coupon',sourceId:promotion.snapshot.promotion.coupon});
  return importStripePromotion(db,encryptionSecret,scope,item);
 }
 if(input.action==='resumeExport')return {scope,...await resumeStripeExport(db,encryptionSecret,gateway,scope,input.input.productId,input.input.codeId)};
 if(input.action==='exportPromotion')return {scope,...await exportStripePromotion(db,encryptionSecret,gateway,scope,input.input)};
 if(input.action==='importPromotion')return {scope,...await importOne(input.input)};
 if(input.action==='importPromotions'){
  const {promotionIds,...settings}=input.input;
  const results:Array<{promotionId:string;batchId?:string;codeId?:string;error?:string}>=[];
  // 逐筆提交，部分失敗不回滾已完成項目；原設定重送沿用每個來源的唯一關聯。
  for(const promotionId of promotionIds){
   try{results.push({promotionId,...await importOne({...settings,promotionId})});}
   catch(error){const code=error instanceof Error?error.message:'';
    results.push({promotionId,error:['STRIPE_INVENTORY_CONFLICT','DUPLICATE_CODES','STRIPE_INVENTORY_UNAVAILABLE'].includes(code)?code:'STRIPE_IMPORT_FAILED'});
   }
  }
  return {scope,results};
 }
 if(input.action==='operations')return {scope,...await listStripeDiscountOperations(db,scope,input.page)};
 if(input.action==='resume'||input.action==='recover'){
  const created=input.action==='resume'?await resumeStripeDiscount(db,encryptionSecret,gateway,scope,input.operationId):await recoverStripeDiscount(db,encryptionSecret,gateway,scope,input.operationId,input.sourceId);
  const row=await db.prepare('SELECT kind FROM stripe_discount_operations WHERE id=? AND account_id=? AND livemode=?').bind(input.operationId,scope.accountId,Number(scope.livemode)).first<{kind:'coupon'|'promotion_code'}>();
  if(!row)throw new Error('STRIPE_OPERATION_NOT_FOUND');
  try{const synced=await pullStripeDiscount(db,encryptionSecret,gateway,{...scope,kind:row.kind,sourceId:created.sourceId});return {scope,...created,synced:synced.stored};}
  catch{return {scope,...created,synced:false};}
 }
 if(input.action==='catalog')return {scope,...await listStripeDiscounts(db,{...scope,kind:input.kind,page:input.page})};
 if(input.action==='discover'){
  const list=input.kind==='coupon'?await gateway.listCoupons({limit:25,startingAfter:input.cursor}):await gateway.listPromotions({limit:25,startingAfter:input.cursor});
  if(list.items.some(item=>item.livemode!==scope.livemode))throw new Error('STRIPE_DISCOUNT_MISMATCH');
  // 探索列表只顯示識別與有效狀態；原始分發碼只能由獨立 read 操作取回。
  return {scope,items:list.items.map(item=>({sourceId:item.id,active:item.object==='coupon'?item.valid:item.active})),nextCursor:list.nextCursor};
 }
 if(input.action==='read')return {scope,record:await readStripeDiscount(db,encryptionSecret,{...scope,kind:input.kind,sourceId:input.sourceId})};
 if(input.action==='sync')return {scope,...await pullStripeDiscount(db,encryptionSecret,gateway,{...scope,kind:input.kind,sourceId:input.sourceId})};
 const type=input.action==='createCoupon'?'coupon':'promotion_code';
 const created=await createStripeDiscount(db,encryptionSecret,gateway,scope,input.operationId,{kind:type,input:input.input});
 // 建立收據已持久化；同步失敗仍回傳建立結果，避免前端換 ID 再建。
 try{
  const synced=await pullStripeDiscount(db,encryptionSecret,gateway,{...scope,kind:type,sourceId:created.sourceId});
  return {scope,...created,synced:synced.stored};
 }catch{return {scope,...created,synced:false};}
}

export function discountApiService(env:{STRIPE_SECRET_KEY?:string;CODE_ENCRYPTION_KEY?:string}){
 return async()=>{
  if(!env.CODE_ENCRYPTION_KEY)throw new Error('ENCRYPTION_NOT_CONFIGURED');
  return {encryptionSecret:env.CODE_ENCRYPTION_KEY,connection:await connectStripeDiscounts(env.STRIPE_SECRET_KEY)};
 };
}
