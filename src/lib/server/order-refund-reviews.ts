import {z} from 'zod';

export const refundReviewInput=z.object({orderId:z.uuid(),idempotencyKey:z.uuid(),refundedMinor:z.number().int().positive(),decision:z.enum(['retain','revoke','acknowledge']),note:z.string().trim().min(10).max(2000)}).strict();
export interface RefundReview {id:string;order_id:string;admin_id:string;idempotency_key:string;refunded_minor:number;decision:'retain'|'revoke'|'acknowledge';note:string;created_at:number;}

export async function reviewOrderRefund(db:D1Database,adminId:string,raw:unknown,now=Date.now()){
 z.string().min(1).max(128).parse(adminId);const input=refundReviewInput.parse(raw);
 const existing=()=>db.prepare('SELECT * FROM order_refund_reviews WHERE order_id=? AND idempotency_key=?').bind(input.orderId,input.idempotencyKey).first<RefundReview>();
 const replay=(row:RefundReview)=>{
  if(row.admin_id!==adminId||row.refunded_minor!==input.refundedMinor||row.decision!==input.decision||row.note!==input.note)throw new Error('ORDER_REFUND_REVIEW_CONFLICT');
  return row;
 };
 const previous=await existing();if(previous)return replay(previous);
 try{
  await db.prepare('INSERT INTO order_refund_reviews(id,order_id,admin_id,idempotency_key,refunded_minor,decision,note,created_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(crypto.randomUUID(),input.orderId,adminId,input.idempotencyKey,input.refundedMinor,input.decision,input.note,now).run();
 }catch(error){const previous=await existing();if(previous)return replay(previous);throw error;}
 return (await existing())!;
}
