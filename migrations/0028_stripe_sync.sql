CREATE TABLE stripe_sync_state (
 id INTEGER PRIMARY KEY CHECK(id=1), lease_token TEXT, lease_until INTEGER,
 started_at INTEGER, finished_at INTEGER, checked INTEGER NOT NULL DEFAULT 0,
 failed INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
INSERT INTO stripe_sync_state(id) VALUES(1);
CREATE INDEX stripe_discount_catalog_refresh ON stripe_discount_catalog(account_id,livemode,requested_at);
