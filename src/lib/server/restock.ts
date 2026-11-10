import { z } from "zod";
import { batchInput } from "./inventory";
import { encryptionKey, fingerprint, sealCode } from "../domain/codes";

export const restockInput = batchInput.pick({ productId:true,codes:true,expiresAt:true,maxUses:true,maxDevices:true }).extend({
 batchId:z.string().uuid(),idempotencyKey:z.string().uuid(),
}).strict();

export async function restockBatch(db:D1Database,secret:string,raw:unknown) {
 const input=restockInput.parse(raw);
 if(new Set(input.codes).size!==input.codes.length)throw new Error("DUPLICATE_CODES");
 const hash=await fingerprint(JSON.stringify(input));
 const existing=await db.prepare("SELECT id,payload_hash,code_count FROM stock_additions WHERE batch_id=? AND idempotency_key=?").bind(input.batchId,input.idempotencyKey).first<{id:string;payload_hash:string;code_count:number}>();
 if(existing){
  if(existing.payload_hash!==hash)throw new Error("STOCK_IDEMPOTENCY_CONFLICT");
  return {id:existing.id,count:existing.code_count};
 }
 const key=await encryptionKey(secret),additionId=crypto.randomUUID(),now=Date.now();
 const rows=await Promise.all(input.codes.map(async code=>{
  const id=crypto.randomUUID();return {id,fingerprint:await fingerprint(code),ciphertext:await sealCode(code,key,`${input.productId}:${id}`)};
 }));
 // 收據與入庫使用同一交易；競爭請求只有持有新收據 ID 的那次能寫入。
 await db.batch([
  db.prepare(`INSERT INTO stock_additions(id,batch_id,idempotency_key,payload_hash,code_count,created_at)
   SELECT ?,b.id,?,?,?,? FROM code_batches b JOIN products p ON p.id=b.product_id
   WHERE b.id=? AND b.product_id=? AND p.archived_at IS NULL AND b.source!='stripe'
   ON CONFLICT(batch_id,idempotency_key) DO NOTHING`)
   .bind(additionId,input.idempotencyKey,hash,rows.length,now,input.batchId,input.productId),
  db.prepare(`INSERT INTO codes(id,product_id,batch_id,fingerprint,ciphertext,expires_at,max_uses,max_devices,created_at)
   SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.fingerprint'),json_extract(value,'$.ciphertext'),?,?,?,?
   FROM json_each(?) WHERE EXISTS(SELECT 1 FROM stock_additions WHERE id=?)`)
   .bind(input.productId,input.batchId,input.expiresAt,input.maxUses,input.maxDevices,now,JSON.stringify(rows),additionId),
 ]);
 const receipt=await db.prepare("SELECT id,payload_hash,code_count FROM stock_additions WHERE batch_id=? AND idempotency_key=?").bind(input.batchId,input.idempotencyKey).first<{id:string;payload_hash:string;code_count:number}>();
 if(!receipt)throw new Error("STOCK_SOURCE_UNAVAILABLE");
 if(receipt.payload_hash!==hash)throw new Error("STOCK_IDEMPOTENCY_CONFLICT");
 return {id:receipt.id,count:receipt.code_count};
}
