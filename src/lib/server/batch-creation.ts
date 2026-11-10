import {z} from "zod";
import {createBatch,batchInput} from "./inventory";
import {generateCodes,generationSchema,fingerprint} from "../domain/codes";
export const importedBatchOperation=z.object({action:z.literal('batches.create'),idempotencyKey:z.uuid(),batch:batchInput.extend({source:z.enum(['manual','import'])}).strict()}).strict();
export const generatedBatchOperation=z.object({action:z.literal('batches.generate'),idempotencyKey:z.uuid(),batch:batchInput.omit({codes:true,source:true}).extend({kind:z.enum(['redemption','discount','license']),rules:generationSchema}).strict()}).strict();
const operation=z.discriminatedUnion('action',[importedBatchOperation,generatedBatchOperation]);
export async function createRequestedBatch(db:D1Database,secret:string,raw:unknown){
 const input=operation.parse(raw),hash=await fingerprint(JSON.stringify(input));
 const batch=input.action==='batches.create'?input.batch:{...input.batch,source:'generated',codes:generateCodes(input.batch.rules)};
 return createBatch(db,secret,batch,{key:input.idempotencyKey,hash});
}
// 後台扁平表單轉為與 REST／MCP 一致的有效請求，再計算收據指紋。
export async function createFormBatch(db:D1Database,secret:string,raw:unknown){
 const {idempotencyKey,...batch}=z.object({idempotencyKey:z.uuid(),source:z.enum(['generated','manual','import'])}).passthrough().parse(raw);
 if(batch.source==='generated'){
  const {source,...generated}=batch;void source;
  return createRequestedBatch(db,secret,{action:'batches.generate',idempotencyKey,batch:generated});
 }
 return createRequestedBatch(db,secret,{action:'batches.create',idempotencyKey,batch});
}
