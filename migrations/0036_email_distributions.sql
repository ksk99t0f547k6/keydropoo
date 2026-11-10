-- 尚未註冊的收件人也有獨立庫存與寄送工作，不建立虛構帳號。
CREATE TABLE email_distributions (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id),
 code_id TEXT NOT NULL REFERENCES codes(id),
 user_id TEXT REFERENCES "user"(id),
 assigned_by TEXT NOT NULL REFERENCES "user"(id),
 recipient_ciphertext TEXT NOT NULL,
 recipient_hash TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 note TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 lease_token TEXT,
 lease_until INTEGER,
 message_id TEXT,
 created_at INTEGER NOT NULL,
 UNIQUE(assigned_by,idempotency_key),
 UNIQUE(code_id,recipient_hash)
);
CREATE INDEX email_distributions_due ON email_distributions(status,next_attempt_at);
CREATE INDEX email_distributions_owner ON email_distributions(user_id,created_at);
DROP VIEW code_recipients;
CREATE VIEW code_recipients AS
 SELECT id,code_id,user_id,campaign_id,created_at FROM claims
 UNION ALL SELECT id,code_id,user_id,NULL,created_at FROM code_assignments
 UNION ALL SELECT id,code_id,user_id,NULL,created_at FROM email_distributions;
CREATE TRIGGER email_distribution_validate BEFORE INSERT ON email_distributions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM installation WHERE id=1 AND admin_user_id=NEW.assigned_by)
 THEN RAISE(ABORT,'ASSIGNMENT_FORBIDDEN') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND p.archived_at IS NULL
   AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
   AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id)
   AND ((b.distribution_mode='unique' AND c.status='available'
     AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts WHERE code_id=c.id AND state!='applied')
     AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id)
     AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id))
    OR (b.distribution_mode='shared' AND c.status IN('available','assigned') AND
     (b.shared_claim_limit IS NULL OR (SELECT count(*) FROM code_distribution_usage u
      WHERE u.code_id=c.id AND (u.expires_at IS NULL OR u.expires_at>NEW.created_at))<b.shared_claim_limit)))
 ) THEN RAISE(ABORT,'ASSIGNMENT_UNAVAILABLE') END;
END;
CREATE TRIGGER email_distribution_allocate AFTER INSERT ON email_distributions BEGIN
 UPDATE codes SET status='assigned' WHERE id=NEW.code_id AND status='available';
END;
-- 寄送失敗或取消也不釋放庫存；逾時可能已送達，不得交給其他人。
CREATE TRIGGER email_distribution_identity_immutable BEFORE UPDATE OF product_id,code_id,assigned_by,recipient_ciphertext,recipient_hash,idempotency_key,request_hash,note,created_at ON email_distributions BEGIN
 SELECT RAISE(ABORT,'ASSIGNMENT_IMMUTABLE');
END;
