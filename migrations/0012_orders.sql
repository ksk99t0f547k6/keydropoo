CREATE TABLE orders (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id), batch_id TEXT NOT NULL REFERENCES code_batches(id),
 buyer_key TEXT NOT NULL, user_id TEXT, email TEXT,
 idempotency_key TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), currency TEXT NOT NULL,
 shortage_policy TEXT NOT NULL CHECK(shortage_policy IN ('refund','manual','backorder')),
 revoke_on_refund INTEGER NOT NULL CHECK(revoke_on_refund IN (0,1)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','expired','fulfilled','refund_pending','refunded','manual','backorder')),
 reserved_code_id TEXT NOT NULL REFERENCES codes(id), code_id TEXT UNIQUE REFERENCES codes(id),
 reserved_until INTEGER NOT NULL,
 checkout_session_id TEXT UNIQUE, payment_intent_id TEXT UNIQUE,
 refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_minor>=0 AND refunded_minor<=amount_minor),
 review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN (0,1)),
 paid_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(buyer_key,idempotency_key)
);
CREATE INDEX orders_expiry ON orders(status,reserved_until);
CREATE INDEX orders_customer ON orders(user_id,product_id,paid_at);
CREATE INDEX orders_backorder ON orders(status,product_id,batch_id,created_at);

CREATE TRIGGER order_validate BEFORE INSERT ON orders BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM products p JOIN code_batches b ON b.product_id=p.id JOIN codes c ON c.batch_id=b.id
  WHERE p.id=NEW.product_id AND b.id=NEW.batch_id AND c.id=NEW.reserved_code_id
   AND p.archived_at IS NULL AND p.price_minor=NEW.amount_minor AND p.currency=NEW.currency
   AND p.shortage_policy=NEW.shortage_policy AND p.revoke_on_refund=NEW.revoke_on_refund
   AND c.status='available' AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
 ) THEN RAISE(ABORT,'ORDER_STOCK_UNAVAILABLE') END;
END;
CREATE TRIGGER order_reserve AFTER INSERT ON orders BEGIN
 UPDATE codes SET status='reserved' WHERE id=NEW.reserved_code_id;
END;

-- 結束預留時釋放未交付的碼；已被管理員撤銷的碼仍保持撤銷。
CREATE TRIGGER order_release AFTER UPDATE OF status ON orders
WHEN OLD.status='pending' AND NEW.status!='pending' BEGIN
 UPDATE codes SET status='available' WHERE id=NEW.reserved_code_id AND status='reserved' AND (NEW.code_id IS NULL OR id!=NEW.code_id);
 UPDATE codes SET previous_status='available' WHERE id=NEW.reserved_code_id AND status='revoked' AND previous_status='reserved' AND (NEW.code_id IS NULL OR id!=NEW.code_id);
END;
CREATE TRIGGER order_delivery_validate BEFORE UPDATE OF code_id ON orders
WHEN OLD.code_id IS NULL AND NEW.code_id IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.paid_at IS NULL OR NEW.refunded_minor>=NEW.amount_minor OR NOT EXISTS(
  SELECT 1 FROM codes c JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND c.batch_id=NEW.batch_id
   AND p.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND (c.status='available' OR (OLD.status='pending' AND c.id=NEW.reserved_code_id AND c.status='reserved'))
 ) THEN RAISE(ABORT,'ORDER_DELIVERY_UNAVAILABLE') END;
END;
CREATE TRIGGER order_assign AFTER UPDATE OF code_id ON orders
WHEN OLD.code_id IS NULL AND NEW.code_id IS NOT NULL BEGIN
 UPDATE codes SET status='assigned' WHERE id=NEW.code_id;
END;

-- 已確認付款才發碼；預留逾時後僅可選可用庫存，不取走其他訂單的預留。
CREATE TRIGGER order_paid AFTER UPDATE OF paid_at ON orders
WHEN OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL AND NEW.refunded_minor<NEW.amount_minor BEGIN
 UPDATE orders SET code_id=(
  SELECT c.id FROM codes c JOIN products p ON p.id=c.product_id
  WHERE c.product_id=NEW.product_id AND c.batch_id=NEW.batch_id AND p.archived_at IS NULL
   AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND (c.status='available' OR (NEW.status='pending' AND c.id=NEW.reserved_code_id AND c.status='reserved'))
  ORDER BY (c.id=NEW.reserved_code_id AND NEW.status='pending') DESC,c.created_at,c.id LIMIT 1
 ) WHERE id=NEW.id;
 UPDATE orders SET status=CASE WHEN code_id IS NOT NULL THEN 'fulfilled' WHEN shortage_policy='refund' THEN 'refund_pending' ELSE shortage_policy END WHERE id=NEW.id;
END;
CREATE TRIGGER order_refunded AFTER UPDATE OF refunded_minor ON orders
WHEN NEW.refunded_minor>OLD.refunded_minor BEGIN
 UPDATE orders SET status=CASE WHEN NEW.refunded_minor=NEW.amount_minor THEN 'refunded' ELSE status END,
  review_required=CASE WHEN NEW.refunded_minor<NEW.amount_minor OR EXISTS(SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id WHERE c.id=NEW.code_id AND b.kind='external') THEN 1 ELSE review_required END
 WHERE id=NEW.id;
 UPDATE codes SET previous_status=status,status='revoked'
 WHERE id=NEW.code_id AND NEW.refunded_minor=NEW.amount_minor AND NEW.revoke_on_refund=1 AND status!='revoked'
  AND NOT EXISTS(SELECT 1 FROM code_batches b WHERE b.id=codes.batch_id AND b.kind='external');
END;

-- 已售碼的內建兌換與免費活動一樣，必須屬於該帳號。
CREATE TRIGGER order_redemption_owner BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM orders WHERE code_id=NEW.code_id AND (user_id IS NULL OR user_id!=NEW.user_id)) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;
