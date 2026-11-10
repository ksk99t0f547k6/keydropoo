-- 審查與權益變動同一筆交易完成；同一累計退款金額只能決定一次。
CREATE TABLE order_refund_reviews (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id),
 admin_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 refunded_minor INTEGER NOT NULL CHECK(refunded_minor>0),
 decision TEXT NOT NULL CHECK(decision IN ('retain','revoke','acknowledge')),
 note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 10 AND 2000),
 created_at INTEGER NOT NULL,
 UNIQUE(order_id,idempotency_key),
 UNIQUE(order_id,refunded_minor)
);
CREATE TRIGGER order_refund_review_validate BEFORE INSERT ON order_refund_reviews BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM orders o JOIN code_batches b ON b.id=o.batch_id JOIN codes c ON c.id=o.code_id
  WHERE o.id=NEW.order_id AND o.paid_at IS NOT NULL AND o.review_required=1
   AND o.refunded_minor=NEW.refunded_minor AND o.status IN ('fulfilled','refunded')
   AND (
    (NEW.decision IN ('retain','revoke') AND b.kind!='external' AND o.access_revoked_at IS NULL AND c.status!='revoked')
    OR (NEW.decision='acknowledge' AND (b.kind='external' OR o.access_revoked_at IS NOT NULL OR c.status='revoked'))
   )
 ) THEN RAISE(ABORT,'ORDER_REFUND_REVIEW_CONFLICT') END;
END;
CREATE TRIGGER order_refund_review_apply AFTER INSERT ON order_refund_reviews BEGIN
 UPDATE orders SET review_required=0,updated_at=NEW.created_at,
  access_revoked_at=CASE WHEN NEW.decision='revoke' THEN COALESCE(access_revoked_at,NEW.created_at) ELSE access_revoked_at END
 WHERE id=NEW.order_id;
 -- 共用碼僅撤銷這筆訂單；獨立碼才可撤銷碼本身，沿用原兌換回收觸發器。
 UPDATE codes SET previous_status=status,status='revoked'
 WHERE NEW.decision='revoke' AND status!='revoked' AND id=(SELECT code_id FROM orders WHERE id=NEW.order_id)
  AND EXISTS(SELECT 1 FROM code_batches b WHERE b.id=codes.batch_id AND b.distribution_mode='unique' AND b.kind!='external');
END;
