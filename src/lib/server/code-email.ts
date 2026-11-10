import {z} from 'zod';
import {loadMessages} from '../../i18n/messages';
import {encryptionKey,openCode} from '../domain/codes';
import type {EmailSender} from './env';
import {codeEmailText} from './code-email-content';
async function ownedCode(db:D1Database,userId:string,codeId:string,now:number){
 return db.prepare(`SELECT c.id,c.product_id,c.ciphertext,p.name,u.email,u.locale FROM codes c JOIN products p ON p.id=c.product_id JOIN "user" u ON u.id=?
  WHERE c.id=? AND c.status!='revoked' AND (c.expires_at IS NULL OR c.expires_at>?) AND p.archived_at IS NULL AND u.emailVerified=1
  AND (EXISTS(SELECT 1 FROM code_recipients cl WHERE cl.code_id=c.id AND cl.user_id=u.id)
   OR EXISTS(SELECT 1 FROM orders o WHERE o.code_id=c.id AND o.user_id=u.id AND o.status IN('fulfilled','refunded') AND o.access_revoked_at IS NULL))`)
 .bind(userId,codeId,now).first<{id:string;product_id:string;ciphertext:string;name:string;email:string;locale:string|null}>();
}
export async function queueCodeEmail(db:D1Database,userId:string,raw:unknown){
 z.string().min(1).max(128).parse(userId);
 const input=z.object({codeId:z.uuid(),idempotencyKey:z.uuid()}).strict().parse(raw);
 const existing=await db.prepare('SELECT id,code_id,status FROM code_email_jobs WHERE user_id=? AND idempotency_key=?').bind(userId,input.idempotencyKey).first<{id:string;code_id:string;status:string}>();
 if(existing){if(existing.code_id!==input.codeId)throw new Error('EMAIL_IDEMPOTENCY_CONFLICT');return {id:existing.id,status:existing.status};}
 if(!await ownedCode(db,userId,input.codeId,Date.now()))throw new Error('EMAIL_CODE_UNAVAILABLE');
 const id=crypto.randomUUID(),now=Date.now();
 await db.prepare(`INSERT INTO code_email_jobs(id,user_id,code_id,idempotency_key,next_attempt_at,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING`)
 .bind(id,userId,input.codeId,input.idempotencyKey,now,now).run();
 const saved=await db.prepare('SELECT id,code_id,status FROM code_email_jobs WHERE user_id=? AND idempotency_key=?').bind(userId,input.idempotencyKey).first<{id:string;code_id:string;status:string}>();
 if(!saved||saved.code_id!==input.codeId)throw new Error('EMAIL_IDEMPOTENCY_CONFLICT');
 return {id:saved.id,status:saved.status};
}
// 從已提交的持有紀錄補入佇列，避免領碼／付款與寄信之間中斷而漏寄。
// 保留成功、取消與失敗工作作為去重紀錄；手動重新寄送使用獨立 UUID。
export async function queueAutomaticCodeEmails(db:D1Database,now=Date.now()){
 const result=await db.prepare(`WITH holdings AS (
  SELECT user_id,code_id FROM claims WHERE user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM guest_claim_emails e WHERE e.claim_id=claims.id)
  UNION SELECT user_id,code_id FROM code_assignments
  UNION
  SELECT user_id,code_id FROM orders WHERE user_id IS NOT NULL AND code_id IS NOT NULL
   AND status IN('fulfilled','refunded') AND access_revoked_at IS NULL
 ), eligible AS (
  SELECT h.user_id,h.code_id FROM holdings h JOIN "user" u ON u.id=h.user_id
  JOIN codes c ON c.id=h.code_id JOIN products p ON p.id=c.product_id
  WHERE u.emailVerified=1 AND c.status!='revoked' AND (c.expires_at IS NULL OR c.expires_at>?)
   AND p.archived_at IS NULL AND NOT EXISTS(
    SELECT 1 FROM code_email_jobs j WHERE j.user_id=h.user_id AND j.idempotency_key='automatic:'||h.code_id
   ) ORDER BY h.user_id,h.code_id LIMIT 25
 ) INSERT INTO code_email_jobs(id,user_id,code_id,idempotency_key,next_attempt_at,created_at)
 SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
 user_id,code_id,'automatic:'||code_id,?,? FROM eligible WHERE true
 ON CONFLICT(user_id,idempotency_key) DO NOTHING`).bind(now,now,now).run();
 return {queued:result.meta.changes};
}
export async function deliverCodeEmails(db:D1Database,config:{sender?:EmailSender;from?:string;encryptionSecret?:string;appUrl?:string},now=Date.now()){
 if(!config.sender||!config.from||!config.encryptionSecret)return {sent:0,cancelled:0};
 const from=z.email().parse(config.from),key=await encryptionKey(config.encryptionSecret);
 // 最後一次寄送若中斷，租約到期後停止；接手不應突破五次上限。
 await db.prepare("UPDATE code_email_jobs SET status='failed',lease_token=NULL,lease_until=NULL WHERE attempts>=5 AND ((status='sending' AND lease_until<=?) OR status='pending')").bind(now).run();
 const {results}=await db.prepare(`SELECT id,user_id,code_id FROM code_email_jobs WHERE attempts<5 AND ( (status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?)) ORDER BY next_attempt_at,id LIMIT 10`).bind(now,now).all<{id:string;user_id:string;code_id:string}>();
 const started=Date.now();let sent=0,cancelled=0;
 for(const job of results){
  const at=now+Date.now()-started,lease=crypto.randomUUID();
  const lock=await db.prepare(`UPDATE code_email_jobs SET status='sending',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=? AND attempts<5 AND ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`).bind(lease,at+60000,job.id,at,at).run();
  if(!lock.meta.changes)continue;
  const owned=await ownedCode(db,job.user_id,job.code_id,at);
  if(!owned){await db.prepare("UPDATE code_email_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(job.id,lease).run();cancelled++;continue;}
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const code=await openCode(owned.ciphertext,key,`${owned.product_id}:${owned.id}`);
   // 用收件人偏好的介面語言寄送。
   const {email}=await loadMessages(owned.locale);
   const receipt=await Promise.race([config.sender.send({from,to:z.email().parse(owned.email),subject:email.codeSubject,text:codeEmailText({product:owned.name,code,appUrl:config.appUrl,email})}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EMAIL_TIMEOUT')),10000);})]);
   const messageId=receipt&&typeof receipt==='object'&&'messageId' in receipt&&typeof receipt.messageId==='string'&&receipt.messageId.length<=255?receipt.messageId:null;
   const done=await db.prepare("UPDATE code_email_jobs SET status='sent',message_id=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(messageId,job.id,lease).run();if(done.meta.changes)sent++;
  }catch{
   await db.prepare("UPDATE code_email_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(now+Date.now()-started+300000,job.id,lease).run();
  }finally{if(timer)clearTimeout(timer);}
 }
 return {sent,cancelled};
}

export async function getCodeEmailStatus(db:D1Database,userId:string,id:string){
 z.uuid().parse(id);
 const job=await db.prepare('SELECT id,status,created_at,attempts FROM code_email_jobs WHERE id=? AND user_id=?').bind(id,userId).first<{id:string;status:string;created_at:number;attempts:number}>();
 if(!job)throw new Error('EMAIL_JOB_NOT_FOUND');return job;
}
export async function latestCodeEmailJobs(db:D1Database,userId:string,codeIds:string[]){
 z.array(z.uuid()).max(20).parse(codeIds);
 const {results}=await db.prepare(`SELECT j.id,j.code_id,j.status,j.created_at,j.attempts FROM code_email_jobs j
 WHERE j.user_id=? AND j.code_id IN(SELECT value FROM json_each(?))
 AND NOT EXISTS(SELECT 1 FROM code_email_jobs newer WHERE newer.user_id=j.user_id AND newer.code_id=j.code_id AND (newer.created_at>j.created_at OR (newer.created_at=j.created_at AND newer.id>j.id)))`)
 .bind(userId,JSON.stringify(codeIds)).all<{id:string;code_id:string;status:string;created_at:number;attempts:number}>();return results;
}
