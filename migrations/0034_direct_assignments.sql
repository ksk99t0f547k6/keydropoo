-- 直接指派獨立於活動與付款，保留管理員、收件帳號及原請求紀錄。
CREATE TABLE code_assignments (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id),
 code_id TEXT NOT NULL REFERENCES codes(id),
 user_id TEXT NOT NULL REFERENCES "user"(id),
 assigned_by TEXT NOT NULL REFERENCES "user"(id),
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 note TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(assigned_by,idempotency_key),
 UNIQUE(code_id,user_id)
);
CREATE INDEX assignments_user ON code_assignments(user_id,created_at);
CREATE INDEX assignments_product ON code_assignments(product_id,created_at);
-- 非付款持有關係共用讀取介面；活動專屬計數仍只使用 claims。
CREATE VIEW code_recipients AS
 SELECT id,code_id,user_id,campaign_id,created_at FROM claims
 UNION ALL SELECT id,code_id,user_id,NULL,created_at FROM code_assignments;
DROP VIEW code_distribution_usage;
CREATE VIEW code_distribution_usage AS
 SELECT code_id,NULL AS order_id,NULL AS expires_at FROM code_recipients
 UNION ALL SELECT COALESCE(code_id,reserved_code_id),id,CASE WHEN code_id IS NULL THEN reserved_until ELSE NULL END FROM orders
 WHERE code_id IS NOT NULL OR status='pending';
DROP VIEW license_holders;
CREATE VIEW license_holders AS
 SELECT code_id,user_id FROM code_recipients WHERE user_id IS NOT NULL
 UNION SELECT code_id,user_id FROM orders WHERE code_id IS NOT NULL AND user_id IS NOT NULL AND access_revoked_at IS NULL;
CREATE TRIGGER assignment_validate BEFORE INSERT ON code_assignments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM installation WHERE id=1 AND admin_user_id=NEW.assigned_by)
 THEN RAISE(ABORT,'ASSIGNMENT_FORBIDDEN') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND p.archived_at IS NULL
   AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
   AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM license_holders WHERE code_id=c.id AND user_id=NEW.user_id)
   AND ((b.distribution_mode='unique' AND c.status='available'
     AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts WHERE code_id=c.id AND state!='applied')
     AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id)
     AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id))
    OR (b.distribution_mode='shared' AND c.status IN('available','assigned') AND
     (b.shared_claim_limit IS NULL OR (SELECT count(*) FROM code_distribution_usage u
      WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.created_at))<b.shared_claim_limit)))
 ) THEN RAISE(ABORT,'ASSIGNMENT_UNAVAILABLE') END;
END;
CREATE TRIGGER assignment_immutable BEFORE UPDATE ON code_assignments BEGIN
 SELECT RAISE(ABORT,'ASSIGNMENT_IMMUTABLE');
END;
CREATE TRIGGER assignment_allocate AFTER INSERT ON code_assignments BEGIN
 UPDATE codes SET status='assigned' WHERE id=NEW.code_id AND status='available';
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 VALUES('assignment:'||NEW.id,'code.assigned',NEW.product_id,
 json_object('assignmentId',NEW.id,'codeId',NEW.code_id,'userId',NEW.user_id),NEW.created_at);
END;

DROP TRIGGER redemption_order_source;
CREATE TRIGGER redemption_order_source BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN NEW.source_order_id IS NOT (
  SELECT o.id FROM orders o JOIN codes c ON c.id=o.code_id JOIN code_batches b ON b.id=c.batch_id
  WHERE b.distribution_mode='shared' AND c.id=NEW.code_id AND o.user_id=NEW.user_id AND o.access_revoked_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
  ORDER BY o.created_at,o.id LIMIT 1
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;

DROP TRIGGER external_attempt_validate;
CREATE TRIGGER external_attempt_validate BEFORE INSERT ON external_redemption_attempts BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='redemption' AND p.archived_at IS NULL
   AND c.status IN ('available','assigned') AND c.use_count<c.max_uses AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND user_id IS NOT NULL AND user_id!=NEW.user_id))
    OR (b.distribution_mode='shared' AND ((NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id) AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id))
     OR EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
     OR EXISTS(SELECT 1 FROM orders WHERE code_id=c.id AND user_id=NEW.user_id AND access_revoked_at IS NULL))))
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM reward_rules r WHERE r.id=NEW.rule_id AND r.version=NEW.rule_version AND r.product_id=NEW.product_id AND r.reward_json=NEW.reward_json
   AND r.id=(SELECT rr.id FROM codes c JOIN code_batches b ON b.id=c.batch_id LEFT JOIN code_recipients cl ON cl.code_id=c.id AND (b.distribution_mode='unique' OR cl.user_id=NEW.user_id) JOIN reward_rules rr ON rr.batch_id=c.batch_id
    WHERE c.id=NEW.code_id AND (rr.campaign_id IS NULL OR rr.campaign_id=cl.campaign_id) ORDER BY rr.campaign_id IS NOT NULL DESC,cl.created_at,cl.id,rr.id LIMIT 1)
 ) THEN RAISE(ABORT,'REWARD_CHANGED') END;
END;

DROP TRIGGER external_attempt_order_source;
CREATE TRIGGER external_attempt_order_source BEFORE INSERT ON external_redemption_attempts BEGIN
 SELECT CASE WHEN NEW.source_order_id IS NOT (
  SELECT o.id FROM orders o JOIN codes c ON c.id=o.code_id JOIN code_batches b ON b.id=c.batch_id
  WHERE b.distribution_mode='shared' AND c.id=NEW.code_id AND o.user_id=NEW.user_id AND o.access_revoked_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
  ORDER BY o.created_at,o.id LIMIT 1
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;

DROP TRIGGER external_attempt_retry;
CREATE TRIGGER external_attempt_retry BEFORE UPDATE OF state ON external_redemption_attempts WHEN NEW.state='sending' BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='redemption' AND p.archived_at IS NULL
   AND c.status IN ('available','assigned') AND c.use_count<c.max_uses AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND user_id IS NOT NULL AND user_id!=NEW.user_id))
    OR (b.distribution_mode='shared' AND ((NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id) AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id))
     OR EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
     OR EXISTS(SELECT 1 FROM orders WHERE code_id=c.id AND user_id=NEW.user_id AND access_revoked_at IS NULL))))
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;

DROP TRIGGER redemption_validate;
CREATE TRIGGER redemption_validate BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='redemption' AND p.archived_at IS NULL
   AND c.status IN ('available','assigned') AND c.use_count<c.max_uses AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND user_id IS NOT NULL AND user_id!=NEW.user_id))
    OR (b.distribution_mode='shared' AND ((NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id) AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id))
     OR EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
     OR EXISTS(SELECT 1 FROM orders WHERE code_id=c.id AND user_id=NEW.user_id AND access_revoked_at IS NULL))))
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM reward_rules r WHERE r.id=NEW.rule_id AND r.version=NEW.rule_version AND r.product_id=NEW.product_id AND r.reward_json=NEW.reward_json
   AND r.id=(SELECT rr.id FROM codes c JOIN code_batches b ON b.id=c.batch_id LEFT JOIN code_recipients cl ON cl.code_id=c.id AND (b.distribution_mode='unique' OR cl.user_id=NEW.user_id) JOIN reward_rules rr ON rr.batch_id=c.batch_id
    WHERE c.id=NEW.code_id AND (rr.campaign_id IS NULL OR rr.campaign_id=cl.campaign_id) ORDER BY rr.campaign_id IS NOT NULL DESC,cl.created_at,cl.id,rr.id LIMIT 1)
 ) AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.id=NEW.id AND a.state='sending' AND a.rule_id=NEW.rule_id AND a.rule_version=NEW.rule_version AND a.reward_json=NEW.reward_json AND a.code_id=NEW.code_id AND a.user_id=NEW.user_id)
 THEN RAISE(ABORT,'REWARD_CHANGED') END;
END;
