CREATE TABLE campaigns (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id),
 batch_id TEXT NOT NULL REFERENCES code_batches(id),
 name TEXT NOT NULL,
 slug TEXT NOT NULL UNIQUE,
 description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','archived')),
 visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
 auth_mode TEXT NOT NULL DEFAULT 'anonymous' CHECK(auth_mode IN ('anonymous','email','account')),
 conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json)),
 starts_at INTEGER,
 ends_at INTEGER,
 total_limit INTEGER CHECK(total_limit > 0),
 per_person_limit INTEGER NOT NULL DEFAULT 1 CHECK(per_person_limit > 0),
 claimed_count INTEGER NOT NULL DEFAULT 0 CHECK(claimed_count >= 0),
 version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK(starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);
CREATE INDEX campaigns_product ON campaigns(product_id,status,created_at,id);
CREATE TABLE campaign_credentials (
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 credential_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('passphrase','invitation')),
 secret_hash TEXT NOT NULL,
 revoked_at INTEGER,
 PRIMARY KEY(campaign_id,credential_id,kind)
);
