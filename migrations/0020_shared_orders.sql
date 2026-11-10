-- 共用銷售預留名額，不把整個碼標成 reserved；保留既有訂單與快照。
DROP TRIGGER order_redemption_owner;
CREATE TABLE orders_new (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id), batch_id TEXT NOT NULL REFERENCES code_batches(id),
 buyer_key TEXT NOT NULL, user_id TEXT, email TEXT,
 idempotency_key TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), currency TEXT NOT NULL,
 shortage_policy TEXT NOT NULL CHECK(shortage_policy IN ('refund','manual','backorder')),
 revoke_on_refund INTEGER NOT NULL CHECK(revoke_on_refund IN (0,1)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','expired','fulfilled','refund_pending','refunded','manual','backorder')),
 reserved_code_id TEXT NOT NULL REFERENCES codes(id), code_id TEXT REFERENCES codes(id),
 reserved_until INTEGER NOT NULL,
 checkout_session_id TEXT UNIQUE, payment_intent_id TEXT UNIQUE,
 refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_minor>=0 AND refunded_minor<=amount_minor),
 review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN (0,1)),
 paid_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 checkout_payload_json TEXT CHECK(checkout_payload_json IS NULL OR json_valid(checkout_payload_json)),
 access_revoked_at INTEGER,
 UNIQUE(buyer_key,idempotency_key)
);
INSERT INTO orders_new(id,product_id,batch_id,buyer_key,user_id,email,idempotency_key,amount_minor,currency,shortage_policy,revoke_on_refund,status,reserved_code_id,code_id,reserved_until,checkout_session_id,payment_intent_id,refunded_minor,review_required,paid_at,created_at,updated_at,checkout_payload_json) SELECT id,product_id,batch_id,buyer_key,user_id,email,idempotency_key,amount_minor,currency,shortage_policy,revoke_on_refund,status,reserved_code_id,code_id,reserved_until,checkout_session_id,payment_intent_id,refunded_minor,review_required,paid_at,created_at,updated_at,checkout_payload_json FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE INDEX orders_expiry ON orders(status,reserved_until);
CREATE INDEX orders_customer ON orders(user_id,product_id,paid_at);
CREATE INDEX orders_backorder ON orders(status,product_id,batch_id,created_at);

CREATE INDEX orders_code ON orders(code_id);
CREATE INDEX orders_reserved_code ON orders(reserved_code_id,status);
ALTER TABLE redemptions ADD COLUMN source_order_id TEXT REFERENCES orders(id);
CREATE INDEX redemptions_order ON redemptions(source_order_id);
CREATE VIEW code_distribution_usage AS
 SELECT code_id,NULL AS order_id,NULL AS expires_at FROM claims
 UNION ALL SELECT COALESCE(code_id,reserved_code_id),id,CASE WHEN code_id IS NULL THEN reserved_until ELSE NULL END FROM orders
 WHERE code_id IS NOT NULL OR status='pending';
CREATE TRIGGER order_validate BEFORE INSERT ON orders BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM products p JOIN code_batches b ON b.product_id=p.id JOIN codes c ON c.batch_id=b.id
  WHERE p.id=NEW.product_id AND b.id=NEW.batch_id AND c.id=NEW.reserved_code_id
   AND p.archived_at IS NULL AND p.price_minor=NEW.amount_minor AND p.currency=NEW.currency
   AND p.shortage_policy=NEW.shortage_policy AND p.revoke_on_refund=NEW.revoke_on_refund
   AND ((b.distribution_mode='unique' AND c.status='available') OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.created_at))<b.shared_claim_limit))) AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
 ) THEN RAISE(ABORT,'ORDER_STOCK_UNAVAILABLE') END;
END;
CREATE TRIGGER order_reserve AFTER INSERT ON orders BEGIN
 UPDATE codes SET status='reserved' WHERE id=NEW.reserved_code_id AND EXISTS(SELECT 1 FROM code_batches b WHERE b.id=codes.batch_id AND b.distribution_mode='unique');
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
  SELECT 1 FROM codes c JOIN products p ON p.id=c.product_id JOIN code_batches b ON b.id=c.batch_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND c.batch_id=NEW.batch_id
   AND p.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND (c.status='available' OR (OLD.status='pending' AND c.id=NEW.reserved_code_id AND c.status='reserved'))) OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.updated_at) AND (u.order_id IS NULL OR u.order_id!=NEW.id))<b.shared_claim_limit)))
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
  SELECT c.id FROM codes c JOIN products p ON p.id=c.product_id JOIN code_batches b ON b.id=c.batch_id
  WHERE c.product_id=NEW.product_id AND c.batch_id=NEW.batch_id AND p.archived_at IS NULL
   AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND (c.status='available' OR (NEW.status='pending' AND c.id=NEW.reserved_code_id AND c.status='reserved'))) OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.updated_at) AND (u.order_id IS NULL OR u.order_id!=NEW.id))<b.shared_claim_limit)))
  ORDER BY (c.id=NEW.reserved_code_id AND NEW.status='pending') DESC,c.created_at,c.id LIMIT 1
 ) WHERE id=NEW.id;
 UPDATE orders SET status=CASE WHEN code_id IS NOT NULL THEN 'fulfilled' WHEN shortage_policy='refund' THEN 'refund_pending' ELSE shortage_policy END WHERE id=NEW.id;
END;
CREATE TRIGGER order_refunded AFTER UPDATE OF refunded_minor ON orders
WHEN NEW.refunded_minor>OLD.refunded_minor BEGIN
 UPDATE orders SET status=CASE WHEN NEW.refunded_minor=NEW.amount_minor THEN 'refunded' ELSE status END,
  review_required=CASE WHEN NEW.refunded_minor<NEW.amount_minor OR EXISTS(SELECT 1 FROM code_batches b WHERE b.id=NEW.batch_id AND (b.kind='external' OR b.distribution_mode='shared')) THEN 1 ELSE review_required END
 WHERE id=NEW.id;
 UPDATE orders SET access_revoked_at=COALESCE(access_revoked_at,NEW.updated_at) WHERE id=NEW.id AND NEW.refunded_minor=NEW.amount_minor AND NEW.revoke_on_refund=1 AND EXISTS(SELECT 1 FROM code_batches b WHERE b.id=NEW.batch_id AND b.distribution_mode='shared');
 UPDATE codes SET previous_status=status,status='revoked'
 WHERE id=NEW.code_id AND NEW.refunded_minor=NEW.amount_minor AND NEW.revoke_on_refund=1 AND status!='revoked'
  AND EXISTS(SELECT 1 FROM code_batches b WHERE b.id=codes.batch_id AND b.kind!='external' AND b.distribution_mode='unique');
END;

CREATE TRIGGER order_access_revoke AFTER UPDATE OF access_revoked_at ON orders
WHEN OLD.access_revoked_at IS NULL AND NEW.access_revoked_at IS NOT NULL BEGIN
 UPDATE redemptions SET revoked_at=NEW.access_revoked_at WHERE source_order_id=NEW.id AND revoked_at IS NULL;
END;
CREATE TRIGGER order_redemption_owner BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM code_batches b JOIN codes c ON c.batch_id=b.id WHERE c.id=NEW.code_id AND b.distribution_mode='unique')
 AND EXISTS(SELECT 1 FROM orders WHERE code_id=NEW.code_id AND (user_id IS NULL OR user_id!=NEW.user_id)) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;
DROP TRIGGER claims_validate;
DROP TRIGGER claims_allocate;
DROP TRIGGER redemption_validate;
CREATE TRIGGER claims_validate BEFORE INSERT ON claims BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c JOIN products p ON p.id=c.product_id JOIN codes k ON k.id=NEW.code_id JOIN code_batches b ON b.id=k.batch_id
  WHERE c.id=NEW.campaign_id AND c.version=NEW.campaign_version AND c.status='active' AND p.archived_at IS NULL
   AND k.product_id=c.product_id AND k.batch_id=c.batch_id AND ((b.distribution_mode='unique' AND k.status='available' AND NOT EXISTS(SELECT 1 FROM claims WHERE code_id=k.id))
    OR (b.distribution_mode='shared' AND k.status IN ('available','assigned')
     AND (b.shared_claim_limit IS NULL OR (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=k.id AND (u.expires_at IS NULL OR u.expires_at>NEW.created_at))<b.shared_claim_limit)))
   AND (k.expires_at IS NULL OR k.expires_at>NEW.created_at)
   AND (c.starts_at IS NULL OR c.starts_at<=NEW.created_at) AND (c.ends_at IS NULL OR c.ends_at>NEW.created_at)
   AND (c.total_limit IS NULL OR c.claimed_count<c.total_limit)
   AND (SELECT count(*) FROM claims WHERE campaign_id=c.id AND subject_key=NEW.subject_key)<c.per_person_limit
   AND (NEW.anonymous_ip_key IS NULL OR (SELECT count(*) FROM claims WHERE campaign_id=c.id AND anonymous_ip_key=NEW.anonymous_ip_key)<c.per_person_limit)
   AND (c.visibility='public' OR NEW.link_id IS NOT NULL)
 ) THEN RAISE(ABORT,'CLAIM_UNAVAILABLE') END;
 SELECT CASE WHEN NEW.link_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM campaign_links l WHERE l.id=NEW.link_id AND l.campaign_id=NEW.campaign_id AND l.revoked_at IS NULL
   AND (l.expires_at IS NULL OR l.expires_at>NEW.created_at)
   AND (l.max_claims IS NULL OR l.claimed_count<l.max_claims)
 ) THEN RAISE(ABORT,'CLAIM_LINK_UNAVAILABLE') END;
END;
CREATE TRIGGER claims_allocate AFTER INSERT ON claims BEGIN
 UPDATE codes SET status='assigned' WHERE id=NEW.code_id;
 UPDATE campaigns SET claimed_count=claimed_count+1 WHERE id=NEW.campaign_id;
 UPDATE campaign_links SET claimed_count=claimed_count+1 WHERE id=NEW.link_id;
END;
CREATE TRIGGER redemption_validate BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='redemption' AND p.archived_at IS NULL
   AND c.status IN ('available','assigned') AND c.use_count<c.max_uses AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM claims WHERE code_id=c.id AND user_id IS NOT NULL AND user_id!=NEW.user_id))
    OR (b.distribution_mode='shared' AND ((NOT EXISTS(SELECT 1 FROM claims WHERE code_id=c.id) AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id))
     OR EXISTS(SELECT 1 FROM claims WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
     OR EXISTS(SELECT 1 FROM orders WHERE code_id=c.id AND user_id=NEW.user_id AND access_revoked_at IS NULL))))
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM reward_rules r WHERE r.id=NEW.rule_id AND r.version=NEW.rule_version AND r.product_id=NEW.product_id AND r.reward_json=NEW.reward_json
   AND r.id=(SELECT rr.id FROM codes c JOIN code_batches b ON b.id=c.batch_id LEFT JOIN claims cl ON cl.code_id=c.id AND (b.distribution_mode='unique' OR cl.user_id=NEW.user_id) JOIN reward_rules rr ON rr.batch_id=c.batch_id
    WHERE c.id=NEW.code_id AND (rr.campaign_id IS NULL OR rr.campaign_id=cl.campaign_id) ORDER BY rr.campaign_id IS NOT NULL DESC,cl.created_at,cl.id,rr.id LIMIT 1)
 ) THEN RAISE(ABORT,'REWARD_CHANGED') END;
END;
CREATE TRIGGER redemption_order_source BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN NEW.source_order_id IS NOT (
  SELECT o.id FROM orders o JOIN codes c ON c.id=o.code_id JOIN code_batches b ON b.id=c.batch_id
  WHERE b.distribution_mode='shared' AND c.id=NEW.code_id AND o.user_id=NEW.user_id AND o.access_revoked_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM claims WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
  ORDER BY o.created_at,o.id LIMIT 1
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;
CREATE TRIGGER event_order_delivered AFTER UPDATE OF status ON orders
WHEN NEW.status='fulfilled' AND OLD.status!='fulfilled' BEGIN
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 VALUES('delivery:'||NEW.id,'order.delivered',NEW.product_id,
 json_object('orderId',NEW.id,'codeId',NEW.code_id,'userId',NEW.user_id),NEW.updated_at);
END;
CREATE TRIGGER event_order_refund AFTER UPDATE OF refunded_minor ON orders
WHEN NEW.refunded_minor>OLD.refunded_minor BEGIN
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 VALUES('refund:'||NEW.id||':'||NEW.refunded_minor,'order.refunded',NEW.product_id,
 json_object('orderId',NEW.id,'refundedMinor',NEW.refunded_minor,'amountMinor',NEW.amount_minor,'currency',NEW.currency),NEW.updated_at);
END;
