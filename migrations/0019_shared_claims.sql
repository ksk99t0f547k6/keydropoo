-- 領取名額與兌換次數分開；舊批次保持獨立碼。
ALTER TABLE code_batches ADD COLUMN distribution_mode TEXT NOT NULL DEFAULT 'unique' CHECK(distribution_mode IN ('unique','shared'));
ALTER TABLE code_batches ADD COLUMN shared_claim_limit INTEGER CHECK(shared_claim_limit IS NULL OR shared_claim_limit BETWEEN 1 AND 1000000);
-- 共用裝置與訂單的所有權整合完成前，資料庫層拒絕尚未支援的組合。
CREATE TRIGGER batch_shared_kind BEFORE INSERT ON code_batches WHEN NEW.distribution_mode='shared' AND NEW.kind='license' BEGIN
 SELECT RAISE(ABORT,'SHARED_LICENSE_PENDING');
END;
CREATE TRIGGER batch_distribution_immutable BEFORE UPDATE OF distribution_mode,shared_claim_limit ON code_batches BEGIN
 SELECT RAISE(ABORT,'BATCH_DISTRIBUTION_IMMUTABLE');
END;
CREATE TRIGGER order_shared_pending BEFORE INSERT ON orders WHEN EXISTS(SELECT 1 FROM code_batches WHERE id=NEW.batch_id AND distribution_mode='shared') BEGIN
 SELECT RAISE(ABORT,'SHARED_SALES_PENDING');
END;
DROP TRIGGER redemption_validate;
CREATE TABLE claims_new (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 campaign_version INTEGER NOT NULL,
 code_id TEXT NOT NULL REFERENCES codes(id),
 subject_key TEXT NOT NULL,
 anonymous_ip_key TEXT,
 user_id TEXT,
 email TEXT,
 idempotency_key TEXT NOT NULL,
 link_id TEXT REFERENCES campaign_links(id),
 created_at INTEGER NOT NULL,
 UNIQUE(campaign_id,subject_key,idempotency_key)
);
INSERT INTO claims_new SELECT * FROM claims;
DROP TABLE claims;
ALTER TABLE claims_new RENAME TO claims;
CREATE INDEX claims_subject ON claims(campaign_id,subject_key);
CREATE INDEX claims_anonymous_ip ON claims(campaign_id,anonymous_ip_key);
CREATE INDEX claims_user ON claims(user_id,created_at);

CREATE INDEX claims_code ON claims(code_id);
CREATE TRIGGER claims_validate BEFORE INSERT ON claims BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c JOIN products p ON p.id=c.product_id JOIN codes k ON k.id=NEW.code_id JOIN code_batches b ON b.id=k.batch_id
  WHERE c.id=NEW.campaign_id AND c.version=NEW.campaign_version AND c.status='active' AND p.archived_at IS NULL
   AND k.product_id=c.product_id AND k.batch_id=c.batch_id AND ((b.distribution_mode='unique' AND k.status='available' AND NOT EXISTS(SELECT 1 FROM claims WHERE code_id=k.id))
    OR (b.distribution_mode='shared' AND k.status IN ('available','assigned')
     AND (b.shared_claim_limit IS NULL OR (SELECT count(*) FROM claims WHERE code_id=k.id)<b.shared_claim_limit)))
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
CREATE TRIGGER redemption_validate BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='redemption' AND p.archived_at IS NULL
   AND c.status IN ('available','assigned') AND c.use_count<c.max_uses AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM claims WHERE code_id=c.id AND user_id IS NOT NULL AND user_id!=NEW.user_id))
    OR (b.distribution_mode='shared' AND (NOT EXISTS(SELECT 1 FROM claims WHERE code_id=c.id)
     OR EXISTS(SELECT 1 FROM claims WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL)))))
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM reward_rules r WHERE r.id=NEW.rule_id AND r.version=NEW.rule_version AND r.product_id=NEW.product_id AND r.reward_json=NEW.reward_json
   AND r.id=(SELECT rr.id FROM codes c JOIN code_batches b ON b.id=c.batch_id LEFT JOIN claims cl ON cl.code_id=c.id AND (b.distribution_mode='unique' OR cl.user_id=NEW.user_id) JOIN reward_rules rr ON rr.batch_id=c.batch_id
    WHERE c.id=NEW.code_id AND (rr.campaign_id IS NULL OR rr.campaign_id=cl.campaign_id) ORDER BY rr.campaign_id IS NOT NULL DESC,cl.created_at,cl.id,rr.id LIMIT 1)
 ) THEN RAISE(ABORT,'REWARD_CHANGED') END;
END;
CREATE TRIGGER event_claim AFTER INSERT ON claims BEGIN
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 SELECT 'claim:'||NEW.id,'code.claimed',c.product_id,
 json_object('claimId',NEW.id,'campaignId',NEW.campaign_id,'codeId',NEW.code_id,'userId',NEW.user_id),NEW.created_at
 FROM campaigns c WHERE c.id=NEW.campaign_id;
END;
