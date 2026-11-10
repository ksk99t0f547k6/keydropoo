CREATE TABLE reward_rules (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id),
 batch_id TEXT NOT NULL REFERENCES code_batches(id),
 campaign_id TEXT REFERENCES campaigns(id),
 reward_json TEXT NOT NULL CHECK(json_valid(reward_json)),
 version INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX reward_rules_batch ON reward_rules(batch_id) WHERE campaign_id IS NULL;
CREATE UNIQUE INDEX reward_rules_campaign ON reward_rules(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE TABLE redemptions (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id),
 code_id TEXT NOT NULL REFERENCES codes(id),
 user_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 rule_id TEXT NOT NULL REFERENCES reward_rules(id),
 rule_version INTEGER NOT NULL,
 reward_json TEXT NOT NULL CHECK(json_valid(reward_json)),
 revoked_at INTEGER,
 created_at INTEGER NOT NULL,
 UNIQUE(user_id,idempotency_key),
 UNIQUE(code_id,user_id)
);
CREATE INDEX redemptions_user ON redemptions(user_id,created_at,id);
CREATE INDEX redemptions_code ON redemptions(code_id);
CREATE TRIGGER redemption_validate BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='redemption' AND p.archived_at IS NULL
   AND c.status IN ('available','assigned') AND c.use_count<c.max_uses AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
   AND NOT EXISTS(SELECT 1 FROM claims WHERE code_id=c.id AND user_id IS NOT NULL AND user_id!=NEW.user_id)
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM reward_rules r WHERE r.id=NEW.rule_id AND r.version=NEW.rule_version AND r.product_id=NEW.product_id AND r.reward_json=NEW.reward_json
   AND r.id=(SELECT rr.id FROM codes c LEFT JOIN claims cl ON cl.code_id=c.id JOIN reward_rules rr ON rr.batch_id=c.batch_id
    WHERE c.id=NEW.code_id AND (rr.campaign_id IS NULL OR rr.campaign_id=cl.campaign_id) ORDER BY rr.campaign_id IS NOT NULL DESC LIMIT 1)
 ) THEN RAISE(ABORT,'REWARD_CHANGED') END;
END;
CREATE TRIGGER redemption_consume AFTER INSERT ON redemptions BEGIN
 UPDATE codes SET use_count=use_count+1,status='assigned' WHERE id=NEW.code_id;
END;
CREATE TRIGGER redemption_credits AFTER INSERT ON redemptions WHEN json_extract(NEW.reward_json,'$.kind')='credits' BEGIN
 INSERT INTO credit_wallets(id,product_id,user_id,bucket,created_at)
 VALUES(NEW.id,NEW.product_id,NEW.user_id,json_extract(NEW.reward_json,'$.bucket'),NEW.created_at)
 ON CONFLICT(product_id,user_id,bucket) DO NOTHING;
 SELECT CASE WHEN json_extract(NEW.reward_json,'$.repeat')='reject' AND EXISTS(
  SELECT 1 FROM credit_grants g JOIN credit_wallets w ON w.id=g.wallet_id WHERE w.product_id=NEW.product_id AND w.user_id=NEW.user_id
   AND w.bucket=json_extract(NEW.reward_json,'$.bucket') AND g.revoked_at IS NULL
 ) THEN RAISE(ABORT,'REWARD_ALREADY_OWNED') END;
 -- 覆蓋只撤銷舊來源尚未消耗額度，保留消耗及退回追蹤，不改寫歷史交易。
 INSERT INTO credit_operations(id,wallet_id,idempotency_key,kind,amount,related_id,created_at)
 SELECT NEW.id||':replace:'||g.id,g.wallet_id,NEW.id||':replace:'||g.id,'revoke',0,g.id,NEW.created_at
 FROM credit_grants g JOIN credit_wallets w ON w.id=g.wallet_id
 WHERE json_extract(NEW.reward_json,'$.repeat')='replace' AND w.product_id=NEW.product_id AND w.user_id=NEW.user_id
  AND w.bucket=json_extract(NEW.reward_json,'$.bucket') AND g.revoked_at IS NULL;
 INSERT INTO credit_operations(id,wallet_id,idempotency_key,kind,amount,related_id,created_at)
 SELECT NEW.id,w.id,NEW.id,'grant',json_extract(NEW.reward_json,'$.amount'),NEW.id,NEW.created_at
 FROM credit_wallets w WHERE w.product_id=NEW.product_id AND w.user_id=NEW.user_id AND w.bucket=json_extract(NEW.reward_json,'$.bucket');
END;
CREATE TRIGGER redemption_revoke_credits AFTER UPDATE OF revoked_at ON redemptions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND json_extract(NEW.reward_json,'$.kind')='credits' AND json_extract(NEW.reward_json,'$.reclaimOnRevoke')=1 BEGIN
 INSERT INTO credit_operations(id,wallet_id,idempotency_key,kind,amount,related_id,created_at)
 SELECT NEW.id||':revoke',g.wallet_id,NEW.id||':revoke','revoke',0,g.id,NEW.revoked_at
 FROM credit_grants g WHERE g.id=NEW.id AND g.revoked_at IS NULL;
END;
CREATE TRIGGER code_revoke_redemptions AFTER UPDATE OF status ON codes
WHEN NEW.status='revoked' AND OLD.status!='revoked' BEGIN
 UPDATE redemptions SET revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE code_id=NEW.id AND revoked_at IS NULL;
END;
