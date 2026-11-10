import { expireReservations,fulfillWaitingOrder } from "./orders";

export async function maintainOrders(db:D1Database,now=Date.now()){
 const {expired}=await expireReservations(db,now);
 // 只選有可交付庫存的自動補發訂單，避免無庫存的舊單阻塞其他批次。
 const {results}=await db.prepare(`SELECT o.id FROM orders o JOIN products p ON p.id=o.product_id
  WHERE o.status='backorder' AND o.paid_at IS NOT NULL AND (o.charged_minor=0 OR o.refunded_minor<o.charged_minor)
  AND o.code_id IS NULL AND p.archived_at IS NULL
  AND EXISTS(SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id WHERE c.batch_id=o.batch_id AND c.product_id=o.product_id
   AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id) AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=c.id AND a.state!='applied') AND c.status='available') OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>?))<b.shared_claim_limit))) AND (c.expires_at IS NULL OR c.expires_at>?))
  ORDER BY o.paid_at,o.created_at,o.id LIMIT 25`).bind(now,now).all<{id:string}>();
 let fulfilled=0;
 for(const order of results){
  // 每筆沿用原子分配；排程重疊、退款或管理員操作後仍重新檢查狀態。
  if((await fulfillWaitingOrder(db,order.id,false,now))?.status==='fulfilled')fulfilled++;
 }
 return {expired,checked:results.length,fulfilled};
}
