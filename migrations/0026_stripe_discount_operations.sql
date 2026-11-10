CREATE TABLE stripe_discount_operations (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, livemode INTEGER NOT NULL CHECK(livemode IN(0,1)),
 kind TEXT NOT NULL CHECK(kind IN('coupon','promotion_code')), request_hash TEXT NOT NULL, request_ciphertext TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN('ready','sending','retryable','applied','review')),
 source_id TEXT, first_attempt_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK(state!='applied' OR source_id IS NOT NULL)
);
CREATE INDEX stripe_discount_operations_pending ON stripe_discount_operations(account_id,livemode,state,updated_at);
