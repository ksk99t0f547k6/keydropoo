CREATE TABLE external_redemption_attempts (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id), code_id TEXT NOT NULL REFERENCES codes(id), user_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, rule_id TEXT NOT NULL REFERENCES reward_rules(id), rule_version INTEGER NOT NULL,
 reward_json TEXT NOT NULL CHECK(json_valid(reward_json)), source_order_id TEXT REFERENCES orders(id),
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','sending','retryable','applied')),
 attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(code_id,user_id), UNIQUE(user_id,idempotency_key)
);
CREATE TABLE external_redemption_keys (
 user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, attempt_id TEXT NOT NULL REFERENCES external_redemption_attempts(id),
 PRIMARY KEY(user_id,idempotency_key)
);
CREATE TABLE admin_notifications (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
 operation_id TEXT NOT NULL, reason TEXT NOT NULL, occurrences INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER
);
CREATE INDEX admin_notifications_open ON admin_notifications(resolved_at,updated_at);
CREATE TRIGGER external_attempt_validate BEFORE INSERT ON external_redemption_attempts BEGIN
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
CREATE TRIGGER external_attempt_order_owner BEFORE INSERT ON external_redemption_attempts BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM code_batches b JOIN codes c ON c.batch_id=b.id WHERE c.id=NEW.code_id AND b.distribution_mode='unique')
 AND EXISTS(SELECT 1 FROM orders WHERE code_id=NEW.code_id AND (user_id IS NULL OR user_id!=NEW.user_id)) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;
CREATE TRIGGER external_attempt_order_source BEFORE INSERT ON external_redemption_attempts BEGIN
 SELECT CASE WHEN NEW.source_order_id IS NOT (
  SELECT o.id FROM orders o JOIN codes c ON c.id=o.code_id JOIN code_batches b ON b.id=c.batch_id
  WHERE b.distribution_mode='shared' AND c.id=NEW.code_id AND o.user_id=NEW.user_id AND o.access_revoked_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM claims WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
  ORDER BY o.created_at,o.id LIMIT 1
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;
CREATE TRIGGER external_attempt_capacity BEFORE INSERT ON external_redemption_attempts BEGIN
 SELECT CASE WHEN json_extract(NEW.reward_json,'$.kind')!='external' OR EXISTS(SELECT 1 FROM redemptions WHERE code_id=NEW.code_id AND user_id=NEW.user_id)
 OR (SELECT use_count+(SELECT count(*) FROM external_redemption_attempts WHERE code_id=NEW.code_id AND state!='applied') FROM codes WHERE id=NEW.code_id)>=(SELECT max_uses FROM codes WHERE id=NEW.code_id)
 THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;
CREATE TRIGGER external_attempt_retry BEFORE UPDATE OF state ON external_redemption_attempts WHEN NEW.state='sending' BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='redemption' AND p.archived_at IS NULL
   AND c.status IN ('available','assigned') AND c.use_count<c.max_uses AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM claims WHERE code_id=c.id AND user_id IS NOT NULL AND user_id!=NEW.user_id))
    OR (b.distribution_mode='shared' AND ((NOT EXISTS(SELECT 1 FROM claims WHERE code_id=c.id) AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id))
     OR EXISTS(SELECT 1 FROM claims WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
     OR EXISTS(SELECT 1 FROM orders WHERE code_id=c.id AND user_id=NEW.user_id AND access_revoked_at IS NULL))))
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;
CREATE TRIGGER external_redemption_capacity BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN (SELECT use_count+(SELECT count(*) FROM external_redemption_attempts WHERE code_id=NEW.code_id AND state!='applied' AND id!=NEW.id) FROM codes WHERE id=NEW.code_id)>=(SELECT max_uses FROM codes WHERE id=NEW.code_id)
 THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
 SELECT CASE WHEN json_extract(NEW.reward_json,'$.kind')='external' AND NOT EXISTS(
 SELECT 1 FROM external_redemption_attempts a WHERE a.id=NEW.id AND a.state='sending' AND a.code_id=NEW.code_id AND a.user_id=NEW.user_id AND a.reward_json=NEW.reward_json
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;
DROP TRIGGER redemption_validate;
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
 ) AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.id=NEW.id AND a.state='sending' AND a.rule_id=NEW.rule_id AND a.rule_version=NEW.rule_version AND a.reward_json=NEW.reward_json AND a.code_id=NEW.code_id AND a.user_id=NEW.user_id)
 THEN RAISE(ABORT,'REWARD_CHANGED') END;
END;

CREATE TRIGGER external_revocation_notice AFTER UPDATE OF revoked_at ON redemptions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND json_extract(NEW.reward_json,'$.kind')='external' AND json_extract(NEW.reward_json,'$.reclaimOnRevoke')=1 BEGIN
 INSERT INTO admin_notifications(id,type,product_id,operation_id,reason,created_at,updated_at)
 VALUES('external-revoke:'||NEW.id,'external_revocation_required',NEW.product_id,NEW.id,'EXTERNAL_REVOCATION_REQUIRED',NEW.revoked_at,NEW.revoked_at);
END;

DROP TRIGGER order_validate;
CREATE TRIGGER order_validate BEFORE INSERT ON orders BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM products p JOIN code_batches b ON b.product_id=p.id JOIN codes c ON c.batch_id=b.id
  WHERE p.id=NEW.product_id AND b.id=NEW.batch_id AND c.id=NEW.reserved_code_id
   AND p.archived_at IS NULL AND p.price_minor=NEW.amount_minor AND p.currency=NEW.currency
   AND p.shortage_policy=NEW.shortage_policy AND p.revoke_on_refund=NEW.revoke_on_refund
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=c.id AND a.state!='applied') AND c.status='available') OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.created_at))<b.shared_claim_limit))) AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
 ) THEN RAISE(ABORT,'ORDER_STOCK_UNAVAILABLE') END;
END;

DROP TRIGGER order_delivery_validate;
CREATE TRIGGER order_delivery_validate BEFORE UPDATE OF code_id ON orders
WHEN OLD.code_id IS NULL AND NEW.code_id IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.paid_at IS NULL OR NEW.refunded_minor>=NEW.amount_minor OR NOT EXISTS(
  SELECT 1 FROM codes c JOIN products p ON p.id=c.product_id JOIN code_batches b ON b.id=c.batch_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND c.batch_id=NEW.batch_id
   AND p.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=c.id AND a.state!='applied') AND (c.status='available' OR (OLD.status='pending' AND c.id=NEW.reserved_code_id AND c.status='reserved'))) OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.updated_at) AND (u.order_id IS NULL OR u.order_id!=NEW.id))<b.shared_claim_limit)))
 ) THEN RAISE(ABORT,'ORDER_DELIVERY_UNAVAILABLE') END;
END;

DROP TRIGGER order_paid;
CREATE TRIGGER order_paid AFTER UPDATE OF paid_at ON orders
WHEN OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL AND NEW.refunded_minor<NEW.amount_minor BEGIN
 UPDATE orders SET code_id=(
  SELECT c.id FROM codes c JOIN products p ON p.id=c.product_id JOIN code_batches b ON b.id=c.batch_id
  WHERE c.product_id=NEW.product_id AND c.batch_id=NEW.batch_id AND p.archived_at IS NULL
   AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=c.id AND a.state!='applied') AND (c.status='available' OR (NEW.status='pending' AND c.id=NEW.reserved_code_id AND c.status='reserved'))) OR (b.distribution_mode='shared' AND c.status IN ('available','assigned') AND (b.shared_claim_limit IS NULL OR
 (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.updated_at) AND (u.order_id IS NULL OR u.order_id!=NEW.id))<b.shared_claim_limit)))
  ORDER BY (c.id=NEW.reserved_code_id AND NEW.status='pending') DESC,c.created_at,c.id LIMIT 1
 ) WHERE id=NEW.id;
 UPDATE orders SET status=CASE WHEN code_id IS NOT NULL THEN 'fulfilled' WHEN shortage_policy='refund' THEN 'refund_pending' ELSE shortage_policy END WHERE id=NEW.id;
END;

DROP TRIGGER claims_validate;
CREATE TRIGGER claims_validate BEFORE INSERT ON claims BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c JOIN products p ON p.id=c.product_id JOIN codes k ON k.id=NEW.code_id JOIN code_batches b ON b.id=k.batch_id
  WHERE c.id=NEW.campaign_id AND c.version=NEW.campaign_version AND c.status='active' AND p.archived_at IS NULL
   AND k.product_id=c.product_id AND k.batch_id=c.batch_id AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=k.id AND a.state!='applied') AND k.status='available' AND NOT EXISTS(SELECT 1 FROM claims WHERE code_id=k.id))
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
