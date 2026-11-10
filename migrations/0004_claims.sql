CREATE TABLE campaign_links (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER,
 max_claims INTEGER CHECK(max_claims > 0),
 claimed_count INTEGER NOT NULL DEFAULT 0 CHECK(claimed_count >= 0),
 revoked_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX campaign_links_campaign ON campaign_links(campaign_id,created_at);
CREATE TABLE claims (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 campaign_version INTEGER NOT NULL,
 code_id TEXT NOT NULL UNIQUE REFERENCES codes(id),
 subject_key TEXT NOT NULL,
 anonymous_ip_key TEXT,
 user_id TEXT,
 email TEXT,
 idempotency_key TEXT NOT NULL,
 link_id TEXT REFERENCES campaign_links(id),
 created_at INTEGER NOT NULL,
 UNIQUE(campaign_id,subject_key,idempotency_key)
);
CREATE INDEX claims_subject ON claims(campaign_id,subject_key);
CREATE INDEX claims_anonymous_ip ON claims(campaign_id,anonymous_ip_key);
CREATE INDEX claims_user ON claims(user_id,created_at);

-- 檢查與計數都在同一 INSERT 交易內，不依賴應用層先讀再寫。
CREATE TRIGGER claims_validate BEFORE INSERT ON claims BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c JOIN products p ON p.id=c.product_id JOIN codes k ON k.id=NEW.code_id
  WHERE c.id=NEW.campaign_id AND c.version=NEW.campaign_version AND c.status='active' AND p.archived_at IS NULL
   AND k.product_id=c.product_id AND k.batch_id=c.batch_id AND k.status='available'
   AND (k.expires_at IS NULL OR k.expires_at>NEW.created_at)
   AND (c.starts_at IS NULL OR c.starts_at<=NEW.created_at) AND (c.ends_at IS NULL OR c.ends_at>NEW.created_at)
   AND (c.total_limit IS NULL OR c.claimed_count<c.total_limit)
   AND (SELECT count(*) FROM claims WHERE campaign_id=c.id AND subject_key=NEW.subject_key)<c.per_person_limit
   AND (NEW.anonymous_ip_key IS NULL OR (SELECT count(*) FROM claims WHERE campaign_id=c.id AND anonymous_ip_key=NEW.anonymous_ip_key)<c.per_person_limit)
   AND (c.visibility='public' OR NEW.link_id IS NOT NULL)
 ) THEN RAISE(ABORT,'CLAIM_UNAVAILABLE') END;
 SELECT CASE WHEN NEW.link_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM campaign_links l WHERE l.id=NEW.link_id AND l.campaign_id=NEW.campaign_id AND l.revoked_at IS NULL
   AND (l.expires_at IS NULL OR l.expires_at>NEW.created_at)
   AND (l.max_claims IS NULL OR l.claimed_count<l.max_claims)
 ) THEN RAISE(ABORT,'CLAIM_LINK_UNAVAILABLE') END;
END;
CREATE TRIGGER claims_allocate AFTER INSERT ON claims BEGIN
 UPDATE codes SET status='assigned' WHERE id=NEW.code_id;
 UPDATE campaigns SET claimed_count=claimed_count+1 WHERE id=NEW.campaign_id;
 UPDATE campaign_links SET claimed_count=claimed_count+1 WHERE id=NEW.link_id;
END;
