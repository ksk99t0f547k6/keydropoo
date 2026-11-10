CREATE TABLE products (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
 description TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'USD',
 price_minor INTEGER NOT NULL DEFAULT 0 CHECK(price_minor >= 0),
 shortage_policy TEXT NOT NULL DEFAULT 'refund' CHECK(shortage_policy IN ('refund','manual','backorder')),
 revoke_on_refund INTEGER NOT NULL DEFAULT 1 CHECK(revoke_on_refund IN (0,1)),
 archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE code_batches (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('redemption','discount','license','external')),
 source TEXT NOT NULL CHECK(source IN ('generated','manual','import','stripe')),
 created_at INTEGER NOT NULL
);
CREATE TABLE codes (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
 batch_id TEXT NOT NULL REFERENCES code_batches(id),
 fingerprint TEXT NOT NULL,
 ciphertext TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','assigned','revoked')),
 previous_status TEXT CHECK(previous_status IN ('available','reserved','assigned')),
 expires_at INTEGER,
 max_uses INTEGER NOT NULL DEFAULT 1 CHECK(max_uses > 0),
 use_count INTEGER NOT NULL DEFAULT 0 CHECK(use_count >= 0 AND use_count <= max_uses),
 max_devices INTEGER NOT NULL DEFAULT 1 CHECK(max_devices > 0),
 created_at INTEGER NOT NULL,
 UNIQUE(product_id, fingerprint)
);
CREATE INDEX codes_inventory ON codes(product_id, status, created_at, id);
CREATE INDEX codes_batch ON codes(batch_id);
