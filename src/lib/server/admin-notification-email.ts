import {loadMessages} from '../../i18n/messages';
import {z} from 'zod';
import type {EmailSender} from './env';
import {notificationKind} from './admin-notifications';

type Config={sender?:EmailSender;from?:string;appUrl?:string;enabled?:boolean};
export async function deliverAdminNotificationEmails(db:D1Database,config:Config,now=Date.now()){
 if(config.enabled===false||!config.sender||!config.from||!config.appUrl)return {sent:0,cancelled:0};
 const from=z.email().parse(config.from),url=new URL(config.appUrl);
 if(url.origin!==config.appUrl||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new Error('INVALID_NOTIFICATION_ORIGIN');
 // 驗證管理員目前信箱後才入列；一輪只補最新版本，避免重試暴增成郵件風暴。
 await db.prepare(`INSERT INTO admin_notification_emails(notification_id,occurrence,next_attempt_at,created_at)
 SELECT n.id,n.occurrences,?,? FROM admin_notifications n
 WHERE n.resolved_at IS NULL AND EXISTS(SELECT 1 FROM installation i JOIN "user" u ON u.id=i.admin_user_id WHERE i.id=1 AND u.emailVerified=1)
 AND NOT EXISTS(SELECT 1 FROM admin_notification_emails e WHERE e.notification_id=n.id AND e.occurrence=n.occurrences)
 ORDER BY n.updated_at,n.id LIMIT 25 ON CONFLICT(notification_id,occurrence) DO NOTHING`).bind(now,now).run();
 await db.prepare(`UPDATE admin_notification_emails SET status='failed',lease_token=NULL,lease_until=NULL
 WHERE attempts>=5 AND (status='pending' OR (status='sending' AND lease_until<=?))`).bind(now).run();
 const {results}=await db.prepare(`SELECT notification_id,occurrence FROM admin_notification_emails WHERE attempts<5
 AND ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?)) ORDER BY next_attempt_at,notification_id LIMIT 10`)
 .bind(now,now).all<{notification_id:string;occurrence:number}>();
 const started=Date.now();let sent=0,cancelled=0;
 for(const job of results){
  const at=now+Date.now()-started,lease=crypto.randomUUID();
  const lock=await db.prepare(`UPDATE admin_notification_emails SET status='sending',attempts=attempts+1,lease_token=?,lease_until=?
  WHERE notification_id=? AND occurrence=? AND attempts<5 AND ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`)
  .bind(lease,at+60000,job.notification_id,job.occurrence,at,at).run();
  if(!lock.meta.changes)continue;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const notice=await db.prepare(`SELECT n.type,n.reason,n.operation_id,u.email,u.locale FROM admin_notifications n
   JOIN installation i ON i.id=1 JOIN "user" u ON u.id=i.admin_user_id
   WHERE n.id=? AND n.occurrences=? AND n.resolved_at IS NULL AND u.emailVerified=1`).bind(job.notification_id,job.occurrence)
   .first<{type:string;reason:string;operation_id:string;email:string;locale:string|null}>();
   if(!notice){
    const result=await db.prepare("UPDATE admin_notification_emails SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE notification_id=? AND occurrence=? AND lease_token=?")
    .bind(job.notification_id,job.occurrence,lease).run();cancelled+=result.meta.changes;continue;
   }
   const kind=notificationKind(notice.type,notice.reason);
   // 用管理員偏好的介面語言寄送。
   const messages=await loadMessages(notice.locale);
   const fields={summary:messages.notifications.kinds[kind],operation:notice.operation_id,url:`${url.origin}/dashboard/notifications`};
   const text=messages.email.adminNotificationBody.replace(/\{(summary|operation|url)\}/g,(_match,field:keyof typeof fields)=>fields[field]);
   await Promise.race([config.sender.send({from,to:z.email().parse(notice.email),subject:messages.email.adminNotificationSubject,text}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EMAIL_TIMEOUT')),10000);})]);
   const result=await db.prepare("UPDATE admin_notification_emails SET status='sent',lease_token=NULL,lease_until=NULL WHERE notification_id=? AND occurrence=? AND lease_token=?")
   .bind(job.notification_id,job.occurrence,lease).run();sent+=result.meta.changes;
  }catch{
   await db.prepare(`UPDATE admin_notification_emails SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE notification_id=? AND occurrence=? AND lease_token=?`)
   .bind(now+Date.now()-started+300000,job.notification_id,job.occurrence,lease).run();
  }finally{if(timer)clearTimeout(timer);}
 }
 return {sent,cancelled};
}
