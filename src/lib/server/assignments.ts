import {z} from 'zod';
import {fingerprint} from '../domain/codes';

export const assignmentInput=z.object({productId:z.uuid(),codeId:z.uuid(),email:z.email().trim().toLowerCase(),note:z.string().trim().min(1).max(1000),idempotencyKey:z.uuid()}).strict();
export async function assignCode(db:D1Database,adminUserId:string,raw:unknown,now=Date.now(),apiTokenId?:string){
 const input=assignmentInput.parse(raw);
 if(!await db.prepare('SELECT id FROM installation WHERE id=1 AND admin_user_id=?').bind(adminUserId).first())throw new Error('ASSIGNMENT_FORBIDDEN');
 if(apiTokenId&&!await db.prepare(`SELECT id FROM api_tokens t WHERE id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)
 AND EXISTS(SELECT 1 FROM json_each(t.scopes_json) WHERE value='codes:issue')
 AND (products_json IS NULL OR EXISTS(SELECT 1 FROM json_each(t.products_json) WHERE value=?))`).bind(apiTokenId,now,input.productId).first())throw new Error('API_SCOPE_DENIED');
 const requestKey=apiTokenId?`token:${apiTokenId}:${input.idempotencyKey}`:input.idempotencyKey;
 const hash=await fingerprint(JSON.stringify(input));
 const find=()=>db.prepare('SELECT id,product_id,code_id,user_id,created_at,request_hash FROM code_assignments WHERE assigned_by=? AND idempotency_key=?')
  .bind(adminUserId,requestKey).first<{id:string;product_id:string;code_id:string;user_id:string;created_at:number;request_hash:string}>();
 function result(row:NonNullable<Awaited<ReturnType<typeof find>>>){
  if(row.request_hash!==hash)throw new Error('ASSIGNMENT_CONFLICT');
  return {id:row.id,productId:row.product_id,codeId:row.code_id,userId:row.user_id,createdAt:row.created_at};
 }
 const previous=await find();if(previous)return result(previous);
 const user=await db.prepare('SELECT id FROM "user" WHERE email=? COLLATE NOCASE').bind(input.email).first<{id:string}>();
 if(!user)throw new Error('ASSIGNMENT_USER_NOT_FOUND');
 try{
  await db.prepare('INSERT INTO code_assignments(id,product_id,code_id,user_id,assigned_by,idempotency_key,request_hash,note,created_at,api_token_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(crypto.randomUUID(),input.productId,input.codeId,user.id,adminUserId,requestKey,hash,input.note,now,apiTokenId??null).run();
 }catch(error){
  const replay=await find();if(replay)return result(replay);
  if(error instanceof Error&&(error.message.includes('ASSIGNMENT_UNAVAILABLE')||error.message.includes('UNIQUE constraint failed')))throw new Error('ASSIGNMENT_UNAVAILABLE');
  throw error;
 }
 return result((await find())!);
}

export async function listAssignments(db:D1Database,raw:unknown){
 const input=z.object({productId:z.uuid(),page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().parse(raw);
 const {results}=await db.prepare(`SELECT a.id,a.code_id,a.user_id,u.email,a.assigned_by,a.api_token_id,a.note,a.created_at,c.status
 FROM code_assignments a JOIN "user" u ON u.id=a.user_id JOIN codes c ON c.id=a.code_id
 WHERE a.product_id=? ORDER BY a.created_at DESC,a.id LIMIT 26 OFFSET ?`)
  .bind(input.productId,(input.page-1)*25).all<{id:string;code_id:string;user_id:string;email:string;assigned_by:string;api_token_id:string|null;note:string;created_at:number;status:string}>();
 return {items:results.slice(0,25),page:input.page,hasMore:results.length>25};
}
