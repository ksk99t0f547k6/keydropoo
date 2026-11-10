import {z} from 'zod';
import {externalGrantInput,type ExternalGrant} from './external-reward-http';
import type {ExternalDispatcher} from './external-redemptions';
export async function deliverExternalRevocations(db:D1Database,dispatch:ExternalDispatcher,now=Date.now()){
 const {results}=await db.prepare("SELECT redemption_id FROM external_revocations WHERE (status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?) ORDER BY next_attempt_at,redemption_id LIMIT 10").bind(now,now).all<{redemption_id:string}>();
 const started=Date.now();let applied=0,failed=0;
 for(const candidate of results){
  const at=now+Math.max(0,Date.now()-started),lease=crypto.randomUUID();
  const lock=await db.prepare(`UPDATE external_revocations SET operation_id=COALESCE(operation_id,?),status='sending',attempts=attempts+1,total_attempts=total_attempts+1,lease_token=?,lease_until=?
 WHERE redemption_id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`).bind(crypto.randomUUID(),lease,at+60000,candidate.redemption_id,at,at).run();
  if(!lock.meta.changes)continue;
  const row=await db.prepare(`SELECT j.operation_id,j.attempts,r.id,r.product_id,r.code_id,r.user_id,r.reward_json FROM external_revocations j JOIN redemptions r ON r.id=j.redemption_id WHERE j.redemption_id=? AND j.lease_token=?`)
   .bind(candidate.redemption_id,lease).first<{operation_id:string;attempts:number;id:string;product_id:string;code_id:string;user_id:string;reward_json:string}>();
  if(!row)continue;
  let success=false;
  try{
   const reward=JSON.parse(row.reward_json) as {integrationId:string;payload:ExternalGrant['reward'];repeat:string;reclaimOnRevoke:boolean};
   const request=externalGrantInput.parse({operationId:row.operation_id,action:'revoke',originalOperationId:row.id,productId:row.product_id,codeId:row.code_id,userId:row.user_id,reward:{payload:reward.payload,repeat:reward.repeat,reclaimOnRevoke:reward.reclaimOnRevoke}});
   const result=await dispatch(reward.integrationId,request);success=result.status==='applied'&&result.operationId===row.operation_id;
  }catch{ /* 未確認結果繼續使用原操作 ID，不記錄外部錯誤本文。 */ }
  const done=now+Math.max(0,Date.now()-started);
  const result=await db.batch([
   db.prepare(`UPDATE external_revocations SET status=?,next_attempt_at=?,applied_at=?,lease_token=NULL,lease_until=NULL WHERE redemption_id=? AND status='sending' AND lease_token=?`)
    .bind(success?'applied':row.attempts>=5?'failed':'pending',done+300000*2**Math.min(row.attempts-1,8),success?done:null,row.id,lease),
   db.prepare(`UPDATE admin_notifications SET resolved_at=? WHERE id=? AND EXISTS(SELECT 1 FROM external_revocations WHERE redemption_id=? AND status='applied')`).bind(done,`external-revoke:${row.id}`,row.id),
  ]);
  if(result[0].meta.changes){if(success)applied++;else failed++;}
 }
 return {applied,failed};
}
export async function listExternalRevocations(db:D1Database,page=1){
 z.number().int().min(1).max(100000).parse(page);
 const {results}=await db.prepare(`SELECT j.redemption_id,j.operation_id,j.status,j.attempts,j.total_attempts,j.retry_count,j.next_attempt_at,j.applied_at,r.product_id,r.user_id,p.name AS product_name
 FROM external_revocations j JOIN redemptions r ON r.id=j.redemption_id JOIN products p ON p.id=r.product_id ORDER BY r.revoked_at DESC,j.redemption_id LIMIT 26 OFFSET ?`).bind((page-1)*25)
 .all<{redemption_id:string;operation_id:string|null;status:'pending'|'sending'|'applied'|'failed';attempts:number;total_attempts:number;retry_count:number;next_attempt_at:number;applied_at:number|null;product_id:string;user_id:string;product_name:string}>();
 return {items:results.slice(0,25),page,hasMore:results.length>25};
}
export async function retryExternalRevocation(db:D1Database,redemptionId:string,now=Date.now()){
 z.uuid().parse(redemptionId);
 const result=await db.prepare("UPDATE external_revocations SET status='pending',attempts=0,retry_count=retry_count+1,next_attempt_at=? WHERE redemption_id=? AND status='failed'").bind(now,redemptionId).run();
 if(!result.meta.changes)throw new Error('EXTERNAL_REVOCATION_RETRY_UNAVAILABLE');return {queued:true};
}
