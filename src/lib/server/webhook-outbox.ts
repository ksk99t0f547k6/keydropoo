export interface WebhookEnvelope {
 id:string;type:string;productId:string;createdAt:number;data:Record<string,unknown>;
}
export interface WebhookTarget {id:string;url:string;secretName:string;}
export type WebhookSender=(target:WebhookTarget,event:WebhookEnvelope)=>Promise<number>;
// 事件通知與外部權益兌換是不同機制；通知重試不重複執行兌換。
export async function deliverWebhookOutbox(db:D1Database,send:WebhookSender,now=Date.now()){
 const {results}=await db.prepare(`SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id=d.endpoint_id
 WHERE e.enabled=1 AND ((d.status='pending' AND d.next_attempt_at<=?) OR (d.status='sending' AND d.lease_until<=?))
 ORDER BY d.next_attempt_at,d.id LIMIT 20`).bind(now,now).all<{id:string}>();
 const startedAt=Date.now();
 let delivered=0,failed=0;
 for(const candidate of results){
  const lease=crypto.randomUUID(),attemptAt=now+Math.max(0,Date.now()-startedAt);
  const claimed=await db.prepare(`UPDATE webhook_deliveries SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,total_attempts=total_attempts+1
   WHERE id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))
   AND EXISTS(SELECT 1 FROM webhook_endpoints e WHERE e.id=endpoint_id AND e.enabled=1)`)
   .bind(lease,attemptAt+60000,candidate.id,attemptAt,attemptAt).run();
  if(!claimed.meta.changes)continue;
  const row=await db.prepare(`SELECT d.attempts,e.id endpoint_id,e.url,e.secret_name,v.id event_id,v.type,v.product_id,v.data_json,v.created_at
   FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id=d.endpoint_id JOIN webhook_events v ON v.id=d.event_id
   WHERE d.id=? AND d.lease_token=? AND e.enabled=1`).bind(candidate.id,lease).first<{attempts:number;endpoint_id:string;url:string;secret_name:string;event_id:string;type:string;product_id:string;data_json:string;created_at:number}>();
  if(!row)continue;
  let status:number|null=null;
  try{
   const result=await send({id:row.endpoint_id,url:row.url,secretName:row.secret_name},{id:row.event_id,type:row.type,productId:row.product_id,createdAt:row.created_at,data:JSON.parse(row.data_json)});
   if(Number.isInteger(result)&&result>=100&&result<=599)status=result;
  }catch{ /* 不儲存外部回應或例外文字，避免洩漏秘密。 */ }
  const success=status!==null&&status>=200&&status<300;
  const terminal=!success&&row.attempts>=8;
  const completedAt=now+Math.max(0,Date.now()-startedAt);
  const saved=await db.prepare(`UPDATE webhook_deliveries SET status=?,last_status=?,delivered_at=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL
   WHERE id=? AND status='sending' AND lease_token=?`)
   .bind(success?'delivered':terminal?'failed':'pending',status,success?completedAt:null,completedAt+Math.min(86400000,60000*2**Math.min(row.attempts,20)),candidate.id,lease).run();
  if(saved.meta.changes){if(success)delivered++;else failed++;}
 }
 return {delivered,failed};
}
