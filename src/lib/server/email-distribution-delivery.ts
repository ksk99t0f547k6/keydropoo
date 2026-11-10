import {loadMessages} from '../../i18n/messages';
import {z} from 'zod';
import {encryptionKey,openCode} from '../domain/codes';
import type {EmailSender} from './env';
import {codeEmailText} from './code-email-content';

export async function deliverEmailDistributions(db:D1Database,config:{sender?:EmailSender;from?:string;encryptionSecret?:string;appUrl?:string},now=Date.now()){
 if(!config.sender||!config.from||!config.encryptionSecret)return {sent:0,cancelled:0};
 const from=z.email().parse(config.from),key=await encryptionKey(config.encryptionSecret);
 // 最後一次嘗試若程序中斷，租約到期後停止，不因接手無限超過重試上限。
 await db.prepare("UPDATE email_distributions SET status='failed',lease_token=NULL,lease_until=NULL WHERE attempts>=5 AND ((status='sending' AND lease_until<=?) OR status='pending')").bind(now).run();
 const {results}=await db.prepare(`SELECT id FROM email_distributions WHERE attempts<5 AND
 ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))
 ORDER BY next_attempt_at,id LIMIT 10`).bind(now,now).all<{id:string}>();
 const started=Date.now();let sent=0,cancelled=0;
 for(const job of results){
  const at=now+Date.now()-started,lease=crypto.randomUUID();
  const lock=await db.prepare(`UPDATE email_distributions SET status='sending',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=? AND attempts<5
  AND ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`).bind(lease,at+60000,job.id,at,at).run();
  if(!lock.meta.changes)continue;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const row=await db.prepare(`SELECT d.recipient_ciphertext,d.locale,c.ciphertext,c.product_id,c.id AS code_id,p.name
   FROM email_distributions d JOIN codes c ON c.id=d.code_id JOIN products p ON p.id=c.product_id
   WHERE d.id=? AND d.lease_token=? AND c.status='assigned' AND p.archived_at IS NULL
   AND (c.expires_at IS NULL OR c.expires_at>?) AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id)`)
    .bind(job.id,lease,at).first<{recipient_ciphertext:string;locale:string|null;ciphertext:string;product_id:string;code_id:string;name:string}>();
   if(!row){
    const result=await db.prepare("UPDATE email_distributions SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(job.id,lease).run();
    cancelled+=result.meta.changes;continue;
   }
   const to=z.email().parse(await openCode(row.recipient_ciphertext,key,`email-distribution:${job.id}`));
   const code=await openCode(row.ciphertext,key,`${row.product_id}:${row.code_id}`);
   // 用建立分發時指定的語言寄送。
   const {email}=await loadMessages(row.locale);
   const text=codeEmailText({product:row.name,code,appUrl:config.appUrl,linkRecipient:true,email});
   const receipt=await Promise.race([config.sender.send({from,to,subject:email.codeSubject,text}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EMAIL_TIMEOUT')),10000);})]);
   const messageId=receipt&&typeof receipt==='object'&&'messageId' in receipt&&typeof receipt.messageId==='string'&&receipt.messageId.length<=255?receipt.messageId:null;
   const result=await db.prepare("UPDATE email_distributions SET status='sent',message_id=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(messageId,job.id,lease).run();
   sent+=result.meta.changes;
  }catch{
   await db.prepare(`UPDATE email_distributions SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
    next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?`).bind(now+Date.now()-started+300000,job.id,lease).run();
  }finally{if(timer)clearTimeout(timer);}
 }
 return {sent,cancelled};
}
