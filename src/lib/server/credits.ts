import {z} from "zod";
const walletInput=z.object({productId:z.uuid(),userId:z.string().min(1).max(128),bucket:z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/)}).strict();
export async function ensureCreditWallet(db:D1Database,raw:unknown){
 const input=walletInput.parse(raw);const id=crypto.randomUUID();
 await db.prepare("INSERT INTO credit_wallets(id,product_id,user_id,bucket,created_at) VALUES(?,?,?,?,?) ON CONFLICT(product_id,user_id,bucket) DO NOTHING").bind(id,input.productId,input.userId,input.bucket,Date.now()).run();
 return (await db.prepare("SELECT id,balance FROM credit_wallets WHERE product_id=? AND user_id=? AND bucket=?").bind(input.productId,input.userId,input.bucket).first<{id:string;balance:number}>())!;
}
export const operationFields=z.object({walletId:z.uuid(),idempotencyKey:z.string().min(1).max(128),kind:z.enum(["grant","spend","refund","revoke"]),amount:z.number().int().min(0).max(1000000000),relatedId:z.string().min(1).max(200).nullable().default(null)}).strict();
function validateOperation(v:{kind:string;amount:number;relatedId:string|null},ctx:z.RefinementCtx){
 if((v.kind==="revoke"?v.amount!==0:v.amount===0)||(v.kind!=="spend"&&!v.relatedId)||(v.kind==="spend"&&v.relatedId!==null))ctx.addIssue({code:"custom",message:"INVALID_CREDIT_OPERATION"});
}
const operationInput=operationFields.superRefine(validateOperation);
interface CreditOperation {id:string;wallet_id:string;idempotency_key:string;kind:"grant"|"spend"|"refund"|"revoke";amount:number;related_id:string|null;balance_delta:number;created_at:number;}
export async function applyCreditOperation(db:D1Database,raw:unknown){
 const input=operationInput.parse(raw);
 async function existing(){return db.prepare("SELECT * FROM credit_operations WHERE wallet_id=? AND idempotency_key=?").bind(input.walletId,input.idempotencyKey).first<CreditOperation>();}
 function replay(row:CreditOperation){if(row.kind!==input.kind||row.amount!==input.amount||row.related_id!==input.relatedId)throw new Error("CREDIT_IDEMPOTENCY_CONFLICT");return row;}
 const previous=await existing();if(previous)return replay(previous);
 try{
  await db.prepare("INSERT INTO credit_operations(id,wallet_id,idempotency_key,kind,amount,related_id,created_at) VALUES(?,?,?,?,?,?,?)")
  .bind(crypto.randomUUID(),input.walletId,input.idempotencyKey,input.kind,input.amount,input.relatedId,Date.now()).run();
 }catch(error){const previous=await existing();if(previous)return replay(previous);throw error;}
 return (await existing())!;
}
export async function creditHistory(db:D1Database,walletId:string,page=1){
 z.uuid().parse(walletId);z.number().int().min(1).max(100000).parse(page);
 const wallet=await db.prepare("SELECT * FROM credit_wallets WHERE id=?").bind(walletId).first<{id:string;product_id:string;user_id:string;bucket:string;balance:number}>();
 if(!wallet)throw new Error("CREDIT_WALLET_NOT_FOUND");
 const {results}=await db.prepare("SELECT * FROM credit_operations WHERE wallet_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?").bind(walletId,(page-1)*50).all<CreditOperation>();
 return {wallet,operations:results.slice(0,50),hasMore:results.length>50,page};
}
export async function creditGrantStatus(db:D1Database,walletId:string,page?:number){
 z.uuid().parse(walletId);
 if(page!==undefined)z.number().int().min(1).max(100000).parse(page);
 const {results}=await db.prepare(`SELECT g.id,g.source_id,g.granted,g.available,g.revoked_at,
 COALESCE((SELECT -SUM(balance_delta) FROM credit_operations WHERE kind='revoke' AND related_id=g.id),0) AS reclaimed,
 COALESCE((SELECT SUM(CASE WHEN o.kind='spend' THEN a.amount WHEN o.kind='refund' THEN -a.amount ELSE 0 END) FROM credit_allocations a JOIN credit_operations o ON o.id=a.operation_id WHERE a.grant_id=g.id),0) AS consumed_outstanding
 FROM credit_grants g WHERE g.wallet_id=? ORDER BY g.created_at,g.id${page===undefined?'':' LIMIT 26 OFFSET ?'}`).bind(...(page===undefined?[walletId]:[walletId,(page-1)*25])).all<{id:string;source_id:string;granted:number;available:number;revoked_at:number|null;reclaimed:number;consumed_outstanding:number}>();
 return results.map(row=>({...row,withheldRefund:row.revoked_at===null?0:row.granted-row.available-row.reclaimed-row.consumed_outstanding}));
}
export async function manageCredits(db:D1Database,raw:unknown){
 const input=z.object({wallet:walletInput,operation:operationFields.omit({walletId:true}).superRefine(validateOperation)}).strict().parse(raw);
 const wallet=await ensureCreditWallet(db,input.wallet);
 const operation=await applyCreditOperation(db,{...input.operation,walletId:wallet.id});
 return {walletId:wallet.id,operation};
}
