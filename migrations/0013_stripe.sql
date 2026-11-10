ALTER TABLE orders ADD COLUMN checkout_payload_json TEXT CHECK(checkout_payload_json IS NULL OR json_valid(checkout_payload_json));
CREATE TABLE stripe_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('processing','processed')),
 lease_token TEXT NOT NULL, lease_until INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, processed_at INTEGER
);

ALTER TABLE products ADD COLUMN checkout_batch_id TEXT REFERENCES code_batches(id);
