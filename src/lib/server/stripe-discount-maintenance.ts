import {z} from 'zod';
import {connectStripeDiscounts} from './stripe-discount-service';
import {pullStripeDiscount} from './stripe-discount-catalog';
interface Options {stripeSecret?:string;encryptionSecret?:string;batchSize?:number;}
type Connect=typeof connectStripeDiscounts;
export async function maintainStripeDiscounts(db:D1Database,options:Options,now=Date.now(),connect:Connect=connectStripeDiscounts){
 const parsedBatch=z.number().int().min(1).max(100).safeParse(options.batchSize??20),batchSize=parsedBatch.success?parsedBatch.data:20;
 const any=await db.prepare('SELECT 1 AS found FROM stripe_discount_catalog LIMIT 1').first();
 if(!any)return {checked:0,failed:0,skipped:true};
 const lease=crypto.randomUUID();
 const lock=await db.prepare(`UPDATE stripe_sync_state SET lease_token=?,lease_until=?,started_at=?,last_error=NULL WHERE id=1 AND (lease_until IS NULL OR lease_until<=?)`).bind(lease,now+600000,now,now).run();
 if(!lock.meta.changes)return {checked:0,failed:0,skipped:true};
 let checked=0,failed=0,error:string|null=parsedBatch.success?null:'STRIPE_SYNC_INVALID_BATCH_SIZE';
 try{
  if(!options.stripeSecret||!options.encryptionSecret){
   error='STRIPE_SYNC_NOT_CONFIGURED';
   await db.prepare("UPDATE stripe_discount_catalog SET last_error=? WHERE last_error IS NOT ?").bind(error,error).run();
   return {checked,failed,skipped:false};
  }
  let connection:Awaited<ReturnType<Connect>>;
  try{connection=await connect(options.stripeSecret);}catch{
   error='STRIPE_IDENTITY_UNAVAILABLE';
   await db.prepare("UPDATE stripe_discount_catalog SET last_error=? WHERE last_error IS NOT ?").bind(error,error).run();
   return {checked,failed,skipped:false};
  }
  const {scope,gateway}=connection;
  // 憑證改綁另一帳戶／模式後，舊範圍不能繼續依過去的有效快照分發。
  await db.prepare("UPDATE stripe_discount_catalog SET last_error='STRIPE_CONNECTION_CHANGED' WHERE (account_id!=? OR livemode!=?) AND last_error IS NOT 'STRIPE_CONNECTION_CHANGED'").bind(scope.accountId,Number(scope.livemode)).run();
  const {results}=await db.prepare(`SELECT kind,source_id FROM stripe_discount_catalog WHERE account_id=? AND livemode=? AND requested_at<=? ORDER BY requested_at,kind,source_id LIMIT ?`)
   .bind(scope.accountId,Number(scope.livemode),now-300000,batchSize).all<{kind:'coupon'|'promotion_code';source_id:string}>();
  // 最多四個同時讀取；單筆失敗不阻塞其他來源，requested_at 使失敗來源輪替到隊尾。
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,results.length)},async()=>{
   for(;;){const item=results[cursor++];if(!item)return;checked++;
    try{await pullStripeDiscount(db,options.encryptionSecret!,gateway,{...scope,kind:item.kind,sourceId:item.source_id},now);}catch{failed++;}
   }
  }));
  if(failed)error='STRIPE_SYNC_PARTIAL_FAILURE';
  return {checked,failed,skipped:false};
 }catch{error='STRIPE_SYNC_FAILED';return {checked,failed,skipped:false};}
 finally{
  await db.prepare(`UPDATE stripe_sync_state SET lease_token=NULL,lease_until=NULL,finished_at=?,checked=?,failed=?,last_error=? WHERE id=1 AND lease_token=?`).bind(Date.now(),checked,failed,error,lease).run();
 }
}
export async function stripeSyncStatus(db:D1Database){return db.prepare('SELECT started_at,finished_at,checked,failed,last_error,lease_until FROM stripe_sync_state WHERE id=1').first<{started_at:number|null;finished_at:number|null;checked:number;failed:number;last_error:string|null;lease_until:number|null}>();}
