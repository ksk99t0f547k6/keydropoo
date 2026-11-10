CREATE TABLE code_email_jobs (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES "user"(id),
 code_id TEXT NOT NULL REFERENCES codes(id),
 idempotency_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','cancelled','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 lease_token TEXT,
 lease_until INTEGER,
 message_id TEXT,
 created_at INTEGER NOT NULL,
 UNIQUE(user_id,idempotency_key)
);
CREATE INDEX code_email_due ON code_email_jobs(status,next_attempt_at);
