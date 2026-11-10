import {assignmentInput} from './assignments';
import {encryptionKey,sealCode} from '../domain/codes';
import {identityHash} from './claim-identity';
import {z} from 'zod';
import {isLocale} from '../../i18n/locales';
import {openCode} from '../domain/codes';

export async function linkEmailDistributions(db:D1Database,userId:string,identitySecret:string,now=Date.now()){
 z.string().min(1).max(128).parse(userId);
 const user=await db.prepare('SELECT email,emailVerified FROM "user" WHERE id=?').bind(userId).first<{email:string;emailVerified:number}>();
 if(!user?.emailVerified)throw new Error('CLAIM_VERIFIED_EMAIL_REQUIRED');
 const email=z.email().parse(user.email).toLowerCase();
 const recipientHash=await identityHash(identitySecret,`email-distribution-recipient:${email}`);
 const result=await db.prepare(`UPDATE email_distributions SET user_id=?,linked_at=? WHERE user_id IS NULL
 AND id IN(SELECT id FROM email_distributions WHERE recipient_hash=? AND user_id IS NULL ORDER BY created_at,id LIMIT 100)
 AND EXISTS(SELECT 1 FROM "user" WHERE id=? AND emailVerified=1 AND email=? COLLATE NOCASE)`)
 .bind(userId,now,recipientHash,userId,email).run();
 return {linked:result.meta.changes};
}

export async function queueEmailDistribution(db:D1Database,adminUserId:string,raw:unknown,secrets:{encryptionSecret:string;identitySecret:string;locale?:string},now=Date.now()){
 const input=assignmentInput.parse(raw);
 // 郵件語言用建立分發的管理員當下的介面語言。
 const locale=isLocale(secrets.locale)?secrets.locale:null;
 if(!await db.prepare('SELECT id FROM installation WHERE id=1 AND admin_user_id=?').bind(adminUserId).first())throw new Error('ASSIGNMENT_FORBIDDEN');
 const requestHash=await identityHash(secrets.identitySecret,`email-distribution-request:${JSON.stringify(input)}`);
 const find=()=>db.prepare('SELECT id,code_id,product_id,status,request_hash FROM email_distributions WHERE assigned_by=? AND idempotency_key=?')
  .bind(adminUserId,input.idempotencyKey).first<{id:string;code_id:string;product_id:string;status:string;request_hash:string}>();
 function result(row:NonNullable<Awaited<ReturnType<typeof find>>>){
  if(row.request_hash!==requestHash)throw new Error('ASSIGNMENT_CONFLICT');
  return {id:row.id,codeId:row.code_id,productId:row.product_id,status:row.status};
 }
 const previous=await find();if(previous)return result(previous);
 const id=crypto.randomUUID(),key=await encryptionKey(secrets.encryptionSecret);
 const ciphertext=await sealCode(input.email,key,`email-distribution:${id}`);
 const recipientHash=await identityHash(secrets.identitySecret,`email-distribution-recipient:${input.email}`);
 try{
  await db.prepare(`INSERT INTO email_distributions(id,product_id,code_id,assigned_by,recipient_ciphertext,recipient_hash,idempotency_key,request_hash,note,next_attempt_at,created_at,locale)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,input.productId,input.codeId,adminUserId,ciphertext,recipientHash,input.idempotencyKey,requestHash,input.note,now,now,locale).run();
 }catch(error){
  const replay=await find();if(replay)return result(replay);
  if(error instanceof Error&&(error.message.includes('ASSIGNMENT_UNAVAILABLE')||error.message.includes('UNIQUE constraint failed')))throw new Error('ASSIGNMENT_UNAVAILABLE');
  throw error;
 }
 return result((await find())!);
}

export async function listEmailDistributions(db:D1Database,encryptionSecret:string,raw:unknown){
 const input=z.object({productId:z.uuid(),page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().parse(raw);
 const {results}=await db.prepare(`SELECT id,code_id,recipient_ciphertext,status,attempts,total_attempts,retry_count,note,created_at,next_attempt_at FROM email_distributions
 WHERE product_id=? ORDER BY created_at DESC,id LIMIT 26 OFFSET ?`).bind(input.productId,(input.page-1)*25)
 .all<{id:string;code_id:string;recipient_ciphertext:string;status:string;attempts:number;total_attempts:number;retry_count:number;note:string;created_at:number;next_attempt_at:number}>();
 const key=await encryptionKey(encryptionSecret);
 return {page:input.page,hasMore:results.length>25,items:await Promise.all(results.slice(0,25).map(async({recipient_ciphertext,...row})=>({...row,email:await openCode(recipient_ciphertext,key,`email-distribution:${row.id}`)})))};
}

export async function retryEmailDistribution(db:D1Database,adminUserId:string,raw:unknown,now=Date.now()){
 const input=z.object({productId:z.uuid(),id:z.uuid(),idempotencyKey:z.uuid(),note:z.string().trim().min(10).max(1000)}).strict().parse(raw);
 if(!await db.prepare('SELECT id FROM installation WHERE id=1 AND admin_user_id=?').bind(adminUserId).first())throw new Error('ASSIGNMENT_FORBIDDEN');
 const exists=await db.prepare('SELECT id FROM email_distributions WHERE id=? AND product_id=?').bind(input.id,input.productId).first();
 if(!exists)throw new Error('EMAIL_RETRY_UNAVAILABLE');
 const find=()=>db.prepare('SELECT id,distribution_id,note FROM email_distribution_retries WHERE admin_user_id=? AND idempotency_key=?').bind(adminUserId,input.idempotencyKey).first<{id:string;distribution_id:string;note:string}>();
 function result(row:NonNullable<Awaited<ReturnType<typeof find>>>){if(row.distribution_id!==input.id||row.note!==input.note)throw new Error('ASSIGNMENT_CONFLICT');return {id:row.id,distributionId:row.distribution_id};}
 const previous=await find();if(previous)return result(previous);
 try{await db.prepare('INSERT INTO email_distribution_retries(id,distribution_id,admin_user_id,idempotency_key,note,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),input.id,adminUserId,input.idempotencyKey,input.note,now).run();}
 catch(error){const replay=await find();if(replay)return result(replay);if(error instanceof Error&&error.message.includes('EMAIL_RETRY_UNAVAILABLE'))throw new Error('EMAIL_RETRY_UNAVAILABLE');throw error;}
 return result((await find())!);
}
