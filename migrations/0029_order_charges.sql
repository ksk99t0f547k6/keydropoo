-- 原價保持不變；付款／退款改以經驗證的實付金額結算。
ALTER TABLE orders ADD COLUMN charged_minor INTEGER CHECK(charged_minor IS NULL OR (charged_minor>=0 AND charged_minor<=amount_minor));
UPDATE orders SET charged_minor=amount_minor WHERE paid_at IS NOT NULL;
CREATE TRIGGER order_charge_guard BEFORE UPDATE ON orders BEGIN
 SELECT CASE WHEN (NEW.charged_minor IS NOT NULL AND NEW.refunded_minor>NEW.charged_minor)
  OR (OLD.paid_at IS NOT NULL AND NEW.charged_minor IS NOT OLD.charged_minor)
  OR (NEW.paid_at IS NOT NULL AND NEW.charged_minor IS NULL)
  THEN RAISE(ABORT,'ORDER_PAYMENT_MISMATCH') END;
END;

DROP TRIGGER order_paid;
CREATE TRIGGER order_paid AFTER UPDATE OF paid_at ON orders
WHEN OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL AND (NEW.charged_minor=0 OR NEW.refunded_minor<NEW.charged_minor) BEGIN
 UPDATE orders SET code_id=(
  SELECT c.id FROM codes c JOIN products p ON p.id=c.product_id JOIN code_batches b ON b.id=c.batch_id
  WHERE NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id) AND c.product_id=NEW.product_id AND c.batch_id=NEW.batch_id AND p.archived_at IS NULL
   AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=c.id AND a.state!='applied') AND (c.status='available' OR (NEW.status='pending' AND c.id=NEW.reserved_code_id AND c.status='reserved'))) OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.updated_at) AND (u.order_id IS NULL OR u.order_id!=NEW.id))<b.shared_claim_limit)))
  ORDER BY (c.id=NEW.reserved_code_id AND NEW.status='pending') DESC,c.created_at,c.id LIMIT 1
 ) WHERE id=NEW.id;
 UPDATE orders SET status=CASE WHEN code_id IS NOT NULL THEN 'fulfilled' WHEN shortage_policy='refund' AND charged_minor=0 THEN 'manual' WHEN shortage_policy='refund' THEN 'refund_pending' ELSE shortage_policy END WHERE id=NEW.id;
END;

DROP TRIGGER order_delivery_validate;
CREATE TRIGGER order_delivery_validate BEFORE UPDATE OF code_id ON orders
WHEN OLD.code_id IS NULL AND NEW.code_id IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.paid_at IS NULL OR (NEW.charged_minor>0 AND NEW.refunded_minor>=NEW.charged_minor) OR NOT EXISTS(
  SELECT 1 FROM codes c JOIN products p ON p.id=c.product_id JOIN code_batches b ON b.id=c.batch_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND c.batch_id=NEW.batch_id
   AND p.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=c.id AND a.state!='applied') AND (c.status='available' OR (OLD.status='pending' AND c.id=NEW.reserved_code_id AND c.status='reserved'))) OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.updated_at) AND (u.order_id IS NULL OR u.order_id!=NEW.id))<b.shared_claim_limit)))
 ) THEN RAISE(ABORT,'ORDER_DELIVERY_UNAVAILABLE') END;
END;

DROP TRIGGER order_refunded;
CREATE TRIGGER order_refunded AFTER UPDATE OF refunded_minor ON orders
WHEN NEW.refunded_minor>OLD.refunded_minor BEGIN
 UPDATE orders SET status=CASE WHEN NEW.refunded_minor=NEW.charged_minor THEN 'refunded' ELSE status END,
  review_required=CASE WHEN NEW.refunded_minor<NEW.charged_minor OR EXISTS(SELECT 1 FROM code_batches b WHERE b.id=NEW.batch_id AND (b.kind='external' OR b.distribution_mode='shared')) THEN 1 ELSE review_required END
 WHERE id=NEW.id;
 UPDATE orders SET access_revoked_at=COALESCE(access_revoked_at,NEW.updated_at) WHERE id=NEW.id AND NEW.refunded_minor=NEW.charged_minor AND NEW.revoke_on_refund=1 AND EXISTS(SELECT 1 FROM code_batches b WHERE b.id=NEW.batch_id AND b.distribution_mode='shared');
 UPDATE codes SET previous_status=status,status='revoked'
 WHERE id=NEW.code_id AND NEW.refunded_minor=NEW.charged_minor AND NEW.revoke_on_refund=1 AND status!='revoked'
  AND EXISTS(SELECT 1 FROM code_batches b WHERE b.id=codes.batch_id AND b.kind!='external' AND b.distribution_mode='unique');
END;

DROP TRIGGER event_order_refund;
CREATE TRIGGER event_order_refund AFTER UPDATE OF refunded_minor ON orders
WHEN NEW.refunded_minor>OLD.refunded_minor BEGIN
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 VALUES('refund:'||NEW.id||':'||NEW.refunded_minor,'order.refunded',NEW.product_id,
 json_object('orderId',NEW.id,'refundedMinor',NEW.refunded_minor,'amountMinor',NEW.charged_minor,'listAmountMinor',NEW.amount_minor,'currency',NEW.currency),NEW.updated_at);
END;
