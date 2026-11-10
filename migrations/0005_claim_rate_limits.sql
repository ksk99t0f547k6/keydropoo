CREATE TABLE claim_rate_limits (
 key TEXT PRIMARY KEY,
 window INTEGER NOT NULL,
 count INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX claim_rate_limits_expiry ON claim_rate_limits(expires_at);
