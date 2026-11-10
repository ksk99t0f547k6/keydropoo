ALTER TABLE email_distributions ADD COLUMN linked_at INTEGER;
CREATE INDEX email_distributions_recipient ON email_distributions(recipient_hash,user_id);
CREATE TRIGGER email_distribution_owner_guard BEFORE UPDATE OF user_id ON email_distributions
WHEN NEW.user_id IS NOT OLD.user_id BEGIN
 SELECT CASE WHEN OLD.user_id IS NOT NULL OR NEW.user_id IS NULL
 OR NOT EXISTS(SELECT 1 FROM "user" WHERE id=NEW.user_id AND emailVerified=1)
 THEN RAISE(ABORT,'EMAIL_OWNER_UNAVAILABLE') END;
END;
