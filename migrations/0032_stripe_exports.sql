-- 推送意圖先持久化；未完成來源關聯前阻止新的分發。
CREATE TABLE stripe_inventory_exports (
 code_id TEXT PRIMARY KEY REFERENCES codes(id), product_id TEXT NOT NULL REFERENCES products(id),
 operation_id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL, livemode INTEGER NOT NULL CHECK(livemode IN(0,1)),
 request_hash TEXT NOT NULL, request_ciphertext TEXT NOT NULL, original_expires_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TRIGGER stripe_export_validate BEFORE INSERT ON stripe_inventory_exports BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
 WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='discount' AND b.source!='stripe'
 AND c.status IN('available','assigned') AND p.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
 AND NOT EXISTS(SELECT 1 FROM stripe_inventory_links WHERE code_id=c.id))
 THEN RAISE(ABORT,'STRIPE_INVENTORY_UNAVAILABLE') END;
END;
ALTER TABLE stripe_inventory_links ADD COLUMN original_expires_at INTEGER;
DROP VIEW stripe_unavailable_codes;
CREATE VIEW stripe_unavailable_codes AS
 SELECT l.code_id FROM stripe_inventory_links l
 JOIN stripe_discount_catalog p ON p.account_id=l.account_id AND p.livemode=l.livemode AND p.kind='promotion_code' AND p.source_id=l.promotion_id
 JOIN stripe_discount_catalog c ON c.account_id=l.account_id AND c.livemode=l.livemode AND c.kind='coupon' AND c.source_id=l.coupon_id
 WHERE p.active IS NOT 1 OR c.active IS NOT 1 OR p.deleted=1 OR c.deleted=1
 OR p.request_version!=p.stored_version OR c.request_version!=c.stored_version OR p.last_error IS NOT NULL OR c.last_error IS NOT NULL
 OR p.code_fingerprint IS NOT l.source_fingerprint OR p.parent_id IS NOT l.coupon_id UNION SELECT e.code_id FROM stripe_inventory_exports e WHERE NOT EXISTS(SELECT 1 FROM stripe_inventory_links l WHERE l.code_id=e.code_id);
DROP TRIGGER stripe_inventory_validate;
CREATE TRIGGER stripe_inventory_validate BEFORE INSERT ON stripe_inventory_links BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM codes k JOIN code_batches b ON b.id=k.batch_id JOIN products product ON product.id=k.product_id
 JOIN stripe_discount_catalog p ON p.account_id=NEW.account_id AND p.livemode=NEW.livemode AND p.kind='promotion_code' AND p.source_id=NEW.promotion_id
 JOIN stripe_discount_catalog c ON c.account_id=NEW.account_id AND c.livemode=NEW.livemode AND c.kind='coupon' AND c.source_id=NEW.coupon_id
 WHERE k.id=NEW.code_id AND k.product_id=NEW.product_id AND b.kind='discount' AND (b.source='stripe' OR EXISTS(SELECT 1 FROM stripe_inventory_exports e WHERE e.code_id=k.id AND e.product_id=k.product_id AND e.account_id=NEW.account_id AND e.livemode=NEW.livemode)) AND product.archived_at IS NULL
 AND p.active=1 AND c.active=1 AND p.deleted=0 AND c.deleted=0 AND p.last_error IS NULL AND c.last_error IS NULL
 AND p.request_version=p.stored_version AND c.request_version=c.stored_version AND p.stored_version=NEW.promotion_version AND c.stored_version=NEW.coupon_version
 AND p.code_fingerprint=NEW.source_fingerprint AND k.fingerprint=NEW.source_fingerprint AND p.parent_id=NEW.coupon_id
 AND (p.expires_at IS NULL OR p.expires_at>NEW.created_at) AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
 ) THEN RAISE(ABORT,'STRIPE_INVENTORY_UNAVAILABLE') END;
END;
DROP TRIGGER stripe_inventory_expiry;
CREATE TRIGGER stripe_inventory_expiry AFTER INSERT ON stripe_inventory_links BEGIN
 UPDATE codes SET expires_at=(SELECT min(value) FROM (SELECT NEW.original_expires_at AS value UNION ALL SELECT expires_at FROM stripe_discount_catalog WHERE account_id=NEW.account_id AND livemode=NEW.livemode AND ((kind='coupon' AND source_id=NEW.coupon_id) OR (kind='promotion_code' AND source_id=NEW.promotion_id)))) WHERE id=NEW.code_id;
END;
DROP TRIGGER stripe_catalog_expiry;
CREATE TRIGGER stripe_catalog_expiry AFTER UPDATE OF expires_at ON stripe_discount_catalog BEGIN
 UPDATE codes SET expires_at=(SELECT min(value) FROM (
 SELECT original_expires_at AS value FROM stripe_inventory_links WHERE code_id=codes.id
 UNION ALL SELECT s.expires_at FROM stripe_discount_catalog s JOIN stripe_inventory_links l ON l.code_id=codes.id AND s.account_id=l.account_id AND s.livemode=l.livemode AND ((s.kind='coupon' AND s.source_id=l.coupon_id) OR (s.kind='promotion_code' AND s.source_id=l.promotion_id))))
 WHERE id IN(SELECT code_id FROM stripe_inventory_links WHERE account_id=NEW.account_id AND livemode=NEW.livemode AND ((NEW.kind='coupon' AND coupon_id=NEW.source_id) OR (NEW.kind='promotion_code' AND promotion_id=NEW.source_id)));
END;
