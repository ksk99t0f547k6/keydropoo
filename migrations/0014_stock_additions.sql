CREATE TABLE stock_additions (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES code_batches(id),
 idempotency_key TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 code_count INTEGER NOT NULL CHECK(code_count BETWEEN 1 AND 1000),
 created_at INTEGER NOT NULL,
 UNIQUE(batch_id,idempotency_key)
);
