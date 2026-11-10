ALTER TABLE email_distributions ADD COLUMN total_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_distributions ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
UPDATE email_distributions SET total_attempts=attempts;
CREATE TRIGGER email_distribution_count_attempts AFTER UPDATE OF attempts ON email_distributions WHEN NEW.attempts>OLD.attempts BEGIN
 UPDATE email_distributions SET total_attempts=total_attempts+NEW.attempts-OLD.attempts WHERE id=NEW.id;
END;
CREATE TABLE email_distribution_retries (
 id TEXT PRIMARY KEY,
 distribution_id TEXT NOT NULL REFERENCES email_distributions(id),
 admin_user_id TEXT NOT NULL REFERENCES "user"(id),
 idempotency_key TEXT NOT NULL,
 note TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(admin_user_id,idempotency_key)
);
CREATE TRIGGER email_distribution_retry_validate BEFORE INSERT ON email_distribution_retries BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM installation WHERE id=1 AND admin_user_id=NEW.admin_user_id)
 THEN RAISE(ABORT,'ASSIGNMENT_FORBIDDEN') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM email_distributions d JOIN codes c ON c.id=d.code_id JOIN products p ON p.id=c.product_id
  WHERE d.id=NEW.distribution_id AND d.status='failed' AND c.status='assigned' AND p.archived_at IS NULL
  AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
  AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id))
 THEN RAISE(ABORT,'EMAIL_RETRY_UNAVAILABLE') END;
END;
CREATE TRIGGER email_distribution_retry_apply AFTER INSERT ON email_distribution_retries BEGIN
 UPDATE email_distributions SET status='pending',attempts=0,retry_count=retry_count+1,next_attempt_at=NEW.created_at,lease_token=NULL,lease_until=NULL WHERE id=NEW.distribution_id;
END;
