ALTER TABLE stripe_discount_catalog ADD COLUMN expires_at INTEGER;
ALTER TABLE stripe_discount_catalog ADD COLUMN parent_id TEXT;
ALTER TABLE stripe_discount_catalog ADD COLUMN code_fingerprint TEXT;
CREATE TABLE stripe_inventory_links (
 code_id TEXT PRIMARY KEY REFERENCES codes(id), product_id TEXT NOT NULL REFERENCES products(id),
 account_id TEXT NOT NULL, livemode INTEGER NOT NULL,
 promotion_id TEXT NOT NULL, promotion_kind TEXT NOT NULL DEFAULT 'promotion_code' CHECK(promotion_kind='promotion_code'),
 coupon_id TEXT NOT NULL, coupon_kind TEXT NOT NULL DEFAULT 'coupon' CHECK(coupon_kind='coupon'),
 promotion_version INTEGER NOT NULL, coupon_version INTEGER NOT NULL, source_fingerprint TEXT NOT NULL,
 import_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(account_id,livemode,promotion_id,product_id),
 FOREIGN KEY(account_id,livemode,promotion_kind,promotion_id) REFERENCES stripe_discount_catalog(account_id,livemode,kind,source_id),
 FOREIGN KEY(account_id,livemode,coupon_kind,coupon_id) REFERENCES stripe_discount_catalog(account_id,livemode,kind,source_id)
);
CREATE VIEW stripe_unavailable_codes AS
 SELECT l.code_id FROM stripe_inventory_links l
 JOIN stripe_discount_catalog p ON p.account_id=l.account_id AND p.livemode=l.livemode AND p.kind='promotion_code' AND p.source_id=l.promotion_id
 JOIN stripe_discount_catalog c ON c.account_id=l.account_id AND c.livemode=l.livemode AND c.kind='coupon' AND c.source_id=l.coupon_id
 WHERE p.active IS NOT 1 OR c.active IS NOT 1 OR p.deleted=1 OR c.deleted=1
 OR p.request_version!=p.stored_version OR c.request_version!=c.stored_version OR p.last_error IS NOT NULL OR c.last_error IS NOT NULL
 OR p.code_fingerprint IS NOT l.source_fingerprint OR p.parent_id IS NOT l.coupon_id;
CREATE TRIGGER stripe_inventory_validate BEFORE INSERT ON stripe_inventory_links BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM codes k JOIN code_batches b ON b.id=k.batch_id JOIN products product ON product.id=k.product_id
 JOIN stripe_discount_catalog p ON p.account_id=NEW.account_id AND p.livemode=NEW.livemode AND p.kind='promotion_code' AND p.source_id=NEW.promotion_id
 JOIN stripe_discount_catalog c ON c.account_id=NEW.account_id AND c.livemode=NEW.livemode AND c.kind='coupon' AND c.source_id=NEW.coupon_id
 WHERE k.id=NEW.code_id AND k.product_id=NEW.product_id AND b.kind='discount' AND b.source='stripe' AND product.archived_at IS NULL
 AND p.active=1 AND c.active=1 AND p.deleted=0 AND c.deleted=0 AND p.last_error IS NULL AND c.last_error IS NULL
 AND p.request_version=p.stored_version AND c.request_version=c.stored_version AND p.stored_version=NEW.promotion_version AND c.stored_version=NEW.coupon_version
 AND p.code_fingerprint=NEW.source_fingerprint AND k.fingerprint=NEW.source_fingerprint AND p.parent_id=NEW.coupon_id
 AND (p.expires_at IS NULL OR p.expires_at>NEW.created_at) AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
 ) THEN RAISE(ABORT,'STRIPE_INVENTORY_UNAVAILABLE') END;
END;
CREATE TRIGGER stripe_inventory_expiry AFTER INSERT ON stripe_inventory_links BEGIN
 UPDATE codes SET expires_at=(SELECT min(expires_at) FROM stripe_discount_catalog WHERE account_id=NEW.account_id AND livemode=NEW.livemode AND ((kind='coupon' AND source_id=NEW.coupon_id) OR (kind='promotion_code' AND source_id=NEW.promotion_id))) WHERE id=NEW.code_id;
END;
CREATE TRIGGER stripe_catalog_expiry AFTER UPDATE OF expires_at ON stripe_discount_catalog BEGIN
 UPDATE codes SET expires_at=(SELECT min(s.expires_at) FROM stripe_discount_catalog s JOIN stripe_inventory_links l ON l.code_id=codes.id AND s.account_id=l.account_id AND s.livemode=l.livemode AND ((s.kind='coupon' AND s.source_id=l.coupon_id) OR (s.kind='promotion_code' AND s.source_id=l.promotion_id)))
 WHERE id IN(SELECT code_id FROM stripe_inventory_links WHERE account_id=NEW.account_id AND livemode=NEW.livemode AND ((NEW.kind='coupon' AND coupon_id=NEW.source_id) OR (NEW.kind='promotion_code' AND promotion_id=NEW.source_id)));
END;
CREATE TRIGGER stripe_claim_guard BEFORE INSERT ON claims WHEN EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=NEW.code_id) BEGIN SELECT RAISE(ABORT,'CLAIM_UNAVAILABLE'); END;
CREATE TRIGGER stripe_order_guard BEFORE INSERT ON orders WHEN EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=NEW.reserved_code_id) BEGIN SELECT RAISE(ABORT,'ORDER_STOCK_UNAVAILABLE'); END;
CREATE TRIGGER stripe_order_delivery_guard BEFORE UPDATE OF code_id ON orders WHEN OLD.code_id IS NULL AND NEW.code_id IS NOT NULL AND EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=NEW.code_id) BEGIN SELECT RAISE(ABORT,'ORDER_DELIVERY_UNAVAILABLE'); END;

DROP TRIGGER order_paid;
CREATE TRIGGER order_paid AFTER UPDATE OF paid_at ON orders
WHEN OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL AND NEW.refunded_minor<NEW.amount_minor BEGIN
 UPDATE orders SET code_id=(
  SELECT c.id FROM codes c JOIN products p ON p.id=c.product_id JOIN code_batches b ON b.id=c.batch_id
  WHERE NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id) AND c.product_id=NEW.product_id AND c.batch_id=NEW.batch_id AND p.archived_at IS NULL
   AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=c.id AND a.state!='applied') AND (c.status='available' OR (NEW.status='pending' AND c.id=NEW.reserved_code_id AND c.status='reserved'))) OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.updated_at) AND (u.order_id IS NULL OR u.order_id!=NEW.id))<b.shared_claim_limit)))
  ORDER BY (c.id=NEW.reserved_code_id AND NEW.status='pending') DESC,c.created_at,c.id LIMIT 1
 ) WHERE id=NEW.id;
 UPDATE orders SET status=CASE WHEN code_id IS NOT NULL THEN 'fulfilled' WHEN shortage_policy='refund' THEN 'refund_pending' ELSE shortage_policy END WHERE id=NEW.id;
END;

-- Stripe 批次的新增碼必須有來源關聯，不能走一般手動補貨。
CREATE TRIGGER stripe_stock_addition_guard BEFORE INSERT ON stock_additions WHEN EXISTS(SELECT 1 FROM code_batches WHERE id=NEW.batch_id AND source='stripe') BEGIN SELECT RAISE(ABORT,'STOCK_SOURCE_UNAVAILABLE'); END;
