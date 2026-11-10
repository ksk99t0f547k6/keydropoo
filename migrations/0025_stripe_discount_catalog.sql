-- Stripe 識別需包含帳戶及 live/test，避免換密鑰後混用資料。
CREATE TABLE stripe_discount_catalog (
 account_id TEXT NOT NULL, livemode INTEGER NOT NULL CHECK(livemode IN(0,1)),
 kind TEXT NOT NULL CHECK(kind IN('coupon','promotion_code')), source_id TEXT NOT NULL,
 request_version INTEGER NOT NULL DEFAULT 0, stored_version INTEGER NOT NULL DEFAULT 0,
 ciphertext TEXT, active INTEGER CHECK(active IN(0,1)), deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),
 requested_at INTEGER NOT NULL, synced_at INTEGER, last_error TEXT,
 PRIMARY KEY(account_id,livemode,kind,source_id),
 CHECK(stored_version<=request_version)
);
CREATE INDEX stripe_discount_catalog_list ON stripe_discount_catalog(account_id,livemode,kind,source_id);
