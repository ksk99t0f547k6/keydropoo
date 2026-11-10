import {z} from 'zod';
import {quarantineExternalAttempts} from './external-redemptions';
export const reviewInput=z.object({attemptId:z.uuid(),outcome:z.enum(['applied','not_applied']),note:z.string().trim().min(10).max(2000)}).strict();
// 管理員先向接收端核對原 operationId，再記錄結果；此處不呼叫外部服務。
export async function resolveExternalReview(db:D1Database,adminId:string,raw:unknown,now=Date.now()){
 const input=reviewInput.parse(raw);z.string().min(1).max(128).parse(adminId);
 await quarantineExternalAttempts(db,now,input.attemptId);
 const id=crypto.randomUUID();
 const statements=[db.prepare(`INSERT INTO external_redemption_reviews(id,attempt_id,admin_id,note,outcome,created_at)
 SELECT ?,id,?,?,?,? FROM external_redemption_attempts WHERE id=? AND review_required=1 AND state='retryable'`).bind(id,adminId,input.note,input.outcome,now,input.attemptId),
 db.prepare(`UPDATE external_redemption_attempts SET review_required=0,state=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM external_redemption_reviews WHERE id=?)`).bind(input.outcome==='applied'?'sending':'retryable',now,input.attemptId,id)];
 if(input.outcome==='applied')statements.push(
  db.prepare(`INSERT INTO redemptions(id,product_id,code_id,user_id,idempotency_key,rule_id,rule_version,reward_json,source_order_id,created_at)
 SELECT id,product_id,code_id,user_id,idempotency_key,rule_id,rule_version,reward_json,source_order_id,? FROM external_redemption_attempts
 WHERE id=? AND EXISTS(SELECT 1 FROM external_redemption_reviews WHERE id=?)`).bind(now,input.attemptId,id),
  db.prepare(`UPDATE external_redemption_attempts SET state='applied' WHERE id=? AND EXISTS(SELECT 1 FROM external_redemption_reviews WHERE id=?)`).bind(input.attemptId,id),
  // 外部已發放、但本地碼在這段時間被撤銷或來源訂單已撤權：補記撤銷，交給既有的外部撤銷排程回收。
  db.prepare(`UPDATE redemptions SET revoked_at=? WHERE id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM external_redemption_reviews WHERE id=?)
 AND (EXISTS(SELECT 1 FROM codes WHERE id=redemptions.code_id AND status='revoked') OR EXISTS(SELECT 1 FROM orders WHERE id=redemptions.source_order_id AND access_revoked_at IS NOT NULL))`).bind(now,input.attemptId,id),
 );
 statements.push(db.prepare(`UPDATE admin_notifications SET resolved_at=? WHERE operation_id=? AND EXISTS(SELECT 1 FROM external_redemption_reviews WHERE id=?)`).bind(now,input.attemptId,id));
 const results=await db.batch(statements);
 if(!results[0].meta.changes)throw new Error('EXTERNAL_REVIEW_UNAVAILABLE');
 return {id,attemptId:input.attemptId,outcome:input.outcome};
}
export interface ExternalReviewRow {id:string;product_id:string;product_name:string;user_id:string;updated_at:number;attempts:number;}
export async function listExternalReviews(db:D1Database,page=1){
 z.number().int().min(1).max(100000).parse(page);
 const {results}=await db.prepare(`SELECT a.id,a.product_id,p.name product_name,a.user_id,a.updated_at,a.attempts FROM external_redemption_attempts a JOIN products p ON p.id=a.product_id
 WHERE a.review_required=1 ORDER BY a.updated_at,a.id LIMIT 26 OFFSET ?`).bind((page-1)*25).all<ExternalReviewRow>();
 return {items:results.slice(0,25),hasMore:results.length>25};
}
