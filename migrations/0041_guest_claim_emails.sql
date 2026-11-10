-- 寄送既有領取，不建立第二份持有紀錄或消耗額外庫存。
CREATE TABLE guest_claim_emails (
 claim_id TEXT PRIMARY KEY REFERENCES claims(id),
 recipient_ciphertext TEXT NOT NULL,
 recipient_hash TEXT NOT NULL,
 anonymous_ip_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 next_attempt_at INTEGER NOT NULL,
 lease_token TEXT,
 lease_until INTEGER,
 message_id TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX guest_claim_emails_due ON guest_claim_emails(status,next_attempt_at);
CREATE INDEX guest_claim_emails_recipient ON guest_claim_emails(recipient_hash,created_at);
CREATE INDEX guest_claim_emails_ip ON guest_claim_emails(anonymous_ip_key,created_at);

CREATE TRIGGER guest_claim_email_limits BEFORE INSERT ON guest_claim_emails BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM guest_claim_emails WHERE recipient_hash=NEW.recipient_hash AND created_at>NEW.created_at-3600000)>=5
 OR (SELECT count(*) FROM guest_claim_emails WHERE anonymous_ip_key=NEW.anonymous_ip_key AND created_at>NEW.created_at-3600000)>=10
 THEN RAISE(ABORT,'GUEST_EMAIL_RATE_LIMITED') END;
END;
CREATE TRIGGER guest_claim_email_immutable BEFORE UPDATE ON guest_claim_emails WHEN
 NEW.claim_id!=OLD.claim_id OR NEW.recipient_ciphertext!=OLD.recipient_ciphertext OR NEW.recipient_hash!=OLD.recipient_hash
 OR NEW.anonymous_ip_key!=OLD.anonymous_ip_key OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT,'GUEST_EMAIL_IMMUTABLE'); END;
