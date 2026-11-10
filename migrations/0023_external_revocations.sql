CREATE TABLE external_revocations (
 redemption_id TEXT PRIMARY KEY REFERENCES redemptions(id),
 operation_id TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','applied','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, total_attempts INTEGER NOT NULL DEFAULT 0, retry_count INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER, applied_at INTEGER
);
CREATE INDEX external_revocations_due ON external_revocations(status,next_attempt_at);
INSERT INTO external_revocations(redemption_id,next_attempt_at)
 SELECT id,revoked_at FROM redemptions WHERE revoked_at IS NOT NULL AND json_extract(reward_json,'$.kind')='external' AND json_extract(reward_json,'$.reclaimOnRevoke')=1;
CREATE TRIGGER external_revocation_queue AFTER UPDATE OF revoked_at ON redemptions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND json_extract(NEW.reward_json,'$.kind')='external' AND json_extract(NEW.reward_json,'$.reclaimOnRevoke')=1 BEGIN
 INSERT INTO external_revocations(redemption_id,next_attempt_at) VALUES(NEW.id,NEW.revoked_at);
END;
