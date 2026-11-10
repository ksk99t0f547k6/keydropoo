import {z} from 'zod';
export async function setSalesBatch(db:D1Database,productId:string,batchId:string|null,allowPromotionCodes?:boolean,stripeProductId?:string|null){
 z.string().regex(/^prod_[A-Za-z0-9]+$/).max(255).nullable().optional().parse(stripeProductId);
 z.boolean().optional().parse(allowPromotionCodes);
 z.uuid().parse(productId);z.uuid().nullable().parse(batchId);
 const result=await db.prepare("UPDATE products SET stripe_product_id=CASE WHEN ? THEN ? ELSE stripe_product_id END,checkout_batch_id=?,allow_promotion_codes=COALESCE(?,allow_promotion_codes),updated_at=? WHERE id=? AND (? IS NULL OR EXISTS(SELECT 1 FROM code_batches WHERE id=? AND product_id=products.id))")
 .bind(Number(stripeProductId!==undefined),stripeProductId??null,batchId,allowPromotionCodes===undefined?null:Number(allowPromotionCodes),Date.now(),productId,batchId,batchId).run();
 if(!result.meta.changes)throw new Error('INVALID_SALES_BATCH');
 return {ok:true};
}
