CREATE TABLE api_tokens (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
 products_json TEXT CHECK(products_json IS NULL OR json_valid(products_json)),
 expires_at INTEGER,
 revoked_at INTEGER,
 created_at INTEGER NOT NULL,
 last_used_at INTEGER
);
