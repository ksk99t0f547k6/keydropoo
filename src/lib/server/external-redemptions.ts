import {externalGrantInput,type ExternalGrant,type ExternalRewardReceipt} from './external-reward-http';
export type ExternalDispatcher=(integrationId:string,input:ExternalGrant)=>Promise<ExternalRewardReceipt>;
export interface ExternalAttempt {
 id:string;product_id:string;code_id:string;user_id:string;idempotency_key:string;rule_id:string;rule_version:number;
 review_required:number;reward_json:string;source_order_id:string|null;created_at:number;state:'ready'|'sending'|'retryable'|'applied';
}
export async function findExternalAttempt(db:D1Database,codeId:string,userId:string){return db.prepare('SELECT * FROM external_redemption_attempts WHERE code_id=? AND user_id=?').bind(codeId,userId).first<ExternalAttempt>();}
export async function runExternalRedemption(db:D1Database,proposal:Omit<ExternalAttempt,'state'|'review_required'>,requestKey:string,dispatch:ExternalDispatcher,now=Date.now()){
 let attempt=await findExternalAttempt(db,proposal.code_id,proposal.user_id);
 if(!attempt){
  try{await db.prepare(`INSERT INTO external_redemption_attempts(id,product_id,code_id,user_id,idempotency_key,rule_id,rule_version,reward_json,source_order_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
   .bind(proposal.id,proposal.product_id,proposal.code_id,proposal.user_id,proposal.idempotency_key,proposal.rule_id,proposal.rule_version,proposal.reward_json,proposal.source_order_id,now,now).run();}
  catch(error){if(!await findExternalAttempt(db,proposal.code_id,proposal.user_id))throw error;}
  attempt=(await findExternalAttempt(db,proposal.code_id,proposal.user_id))!;
 }
 await db.prepare('INSERT INTO external_redemption_keys(user_id,idempotency_key,attempt_id) VALUES(?,?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING').bind(attempt.user_id,requestKey,attempt.id).run();
 const alias=await db.prepare('SELECT attempt_id FROM external_redemption_keys WHERE user_id=? AND idempotency_key=?').bind(attempt.user_id,requestKey).first<{attempt_id:string}>();
 if(alias?.attempt_id!==attempt.id)throw new Error('REDEMPTION_IDEMPOTENCY_CONFLICT');
 if(attempt.state==='applied')return attempt.id;
 await quarantineExternalAttempts(db,now,attempt.id);
 attempt=(await findExternalAttempt(db,proposal.code_id,proposal.user_id))!;
 if(attempt.review_required)throw new Error('EXTERNAL_REDEMPTION_REVIEW_REQUIRED');
 const lease=crypto.randomUUID();
 const lock=await db.prepare(`UPDATE external_redemption_attempts SET state='sending',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
 WHERE id=? AND review_required=0 AND state IN('ready','retryable')`).bind(lease,now+60000,now,attempt.id).run();
 if(!lock.meta.changes)throw new Error('EXTERNAL_REDEMPTION_BUSY');
 const reward=JSON.parse(attempt.reward_json) as {integrationId:string;payload:ExternalGrant['reward'];repeat:string;reclaimOnRevoke:boolean};
 let explicitlyRejected=false;
 try{
  const request=externalGrantInput.parse({operationId:attempt.id,productId:attempt.product_id,codeId:attempt.code_id,userId:attempt.user_id,reward:{payload:reward.payload,repeat:reward.repeat,reclaimOnRevoke:reward.reclaimOnRevoke}});
  const receipt=await dispatch(reward.integrationId,request);
  explicitlyRejected=receipt.operationId===attempt.id&&receipt.status==='rejected';
  if(receipt.operationId!==attempt.id||receipt.status!=='applied')throw new Error('EXTERNAL_REDEMPTION_FAILED');
  await db.batch([
   db.prepare(`INSERT INTO redemptions(id,product_id,code_id,user_id,idempotency_key,rule_id,rule_version,reward_json,source_order_id,created_at)
 SELECT id,product_id,code_id,user_id,idempotency_key,rule_id,rule_version,reward_json,source_order_id,? FROM external_redemption_attempts WHERE id=? AND state='sending' AND lease_token=?`).bind(Date.now(),attempt.id,lease),
   db.prepare(`UPDATE external_redemption_attempts SET state='applied',lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND EXISTS(SELECT 1 FROM redemptions WHERE id=external_redemption_attempts.id)`).bind(attempt.id,lease),
   db.prepare(`UPDATE admin_notifications SET resolved_at=? WHERE operation_id=? AND EXISTS(SELECT 1 FROM external_redemption_attempts WHERE id=? AND state='applied')`).bind(Date.now(),attempt.id,attempt.id),
  ]);
  if((await findExternalAttempt(db,attempt.code_id,attempt.user_id))?.state!=='applied')throw new Error('EXTERNAL_REDEMPTION_BUSY');
  return attempt.id;
 }catch{
  const at=Date.now();const reason=explicitlyRejected?'EXTERNAL_REDEMPTION_FAILED':'EXTERNAL_REDEMPTION_REVIEW_REQUIRED';
  await db.batch([
   db.prepare(`INSERT INTO admin_notifications(id,type,product_id,operation_id,reason,created_at,updated_at)
 SELECT 'external:'||id,'external_redemption_failed',product_id,id,?,?,? FROM external_redemption_attempts WHERE id=? AND lease_token=?
 ON CONFLICT(id) DO UPDATE SET occurrences=occurrences+1,reason=excluded.reason,updated_at=excluded.updated_at,resolved_at=NULL`).bind(reason,at,at,attempt.id,lease),
   db.prepare("UPDATE external_redemption_attempts SET state='retryable',review_required=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?").bind(Number(!explicitlyRejected),at,attempt.id,lease),
  ]);
  throw new Error(reason);
 }
}

export async function quarantineExternalAttempts(db:D1Database,now=Date.now(),attemptId:string|null=null){
 // 程序中斷後無法確認對方結果，不讓下一位使用者接手重送。
 await db.batch([
  db.prepare(`INSERT INTO admin_notifications(id,type,product_id,operation_id,reason,created_at,updated_at)
 SELECT 'external:'||id,'external_redemption_failed',product_id,id,'EXTERNAL_REDEMPTION_REVIEW_REQUIRED',?,? FROM external_redemption_attempts
 WHERE (? IS NULL OR id=?) AND state='sending' AND lease_until<=?
 ON CONFLICT(id) DO UPDATE SET reason=excluded.reason,updated_at=excluded.updated_at,resolved_at=NULL`).bind(now,now,attemptId,attemptId,now),
  db.prepare(`UPDATE external_redemption_attempts SET state='retryable',review_required=1,lease_token=NULL,lease_until=NULL,updated_at=?
 WHERE (? IS NULL OR id=?) AND state='sending' AND lease_until<=?`).bind(now,attemptId,attemptId,now),
 ]);
}
