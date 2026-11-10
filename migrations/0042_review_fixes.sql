-- 2026-11-08 審查修正（Claude）。
-- 1. 訂單記錄來源網段，用來限制同一網段同時未付款的預留數。
ALTER TABLE orders ADD COLUMN ip_key TEXT;
CREATE INDEX orders_pending_ip ON orders(ip_key,status,created_at);
CREATE INDEX orders_pending_buyer ON orders(buyer_key,status,created_at);

-- 2. Stripe 例行刷新進行中（request_version 尚未寫回）時沿用上次成功的快照，
--    不再讓碼短暫變成不可用；同步失敗（last_error）仍維持保守排除。
DROP VIEW stripe_unavailable_codes;
CREATE VIEW stripe_unavailable_codes AS
 SELECT l.code_id FROM stripe_inventory_links l
 JOIN stripe_discount_catalog p ON p.account_id=l.account_id AND p.livemode=l.livemode AND p.kind='promotion_code' AND p.source_id=l.promotion_id
 JOIN stripe_discount_catalog c ON c.account_id=l.account_id AND c.livemode=l.livemode AND c.kind='coupon' AND c.source_id=l.coupon_id
 WHERE p.active IS NOT 1 OR c.active IS NOT 1 OR p.deleted=1 OR c.deleted=1
 OR p.stored_version=0 OR c.stored_version=0 OR p.last_error IS NOT NULL OR c.last_error IS NOT NULL
 OR p.code_fingerprint IS NOT l.source_fingerprint OR p.parent_id IS NOT l.coupon_id UNION SELECT e.code_id FROM stripe_inventory_exports e WHERE NOT EXISTS(SELECT 1 FROM stripe_inventory_links l WHERE l.code_id=e.code_id);

-- 3. 外部權益「已確認沒有發放」（接收端明確拒絕，或管理員審查為 not_applied）的嘗試，
--    狀態是 retryable 且 review_required=0，不再佔用兌換名額（use_count／max_uses）。
--    領取、販售、指派等庫存判斷維持原樣：碼已經被輸入過，不放回庫存重新發出。
DROP TRIGGER external_attempt_capacity;
CREATE TRIGGER external_attempt_capacity BEFORE INSERT ON external_redemption_attempts BEGIN
 SELECT CASE WHEN json_extract(NEW.reward_json,'$.kind')!='external' OR EXISTS(SELECT 1 FROM redemptions WHERE code_id=NEW.code_id AND user_id=NEW.user_id)
 OR (SELECT use_count+(SELECT count(*) FROM external_redemption_attempts WHERE code_id=NEW.code_id AND state!='applied' AND NOT (state='retryable' AND review_required=0)) FROM codes WHERE id=NEW.code_id)>=(SELECT max_uses FROM codes WHERE id=NEW.code_id)
 THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;

DROP TRIGGER external_redemption_capacity;
CREATE TRIGGER external_redemption_capacity BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN (SELECT use_count+(SELECT count(*) FROM external_redemption_attempts WHERE code_id=NEW.code_id AND state!='applied' AND NOT (state='retryable' AND review_required=0) AND id!=NEW.id) FROM codes WHERE id=NEW.code_id)>=(SELECT max_uses FROM codes WHERE id=NEW.code_id)
 THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
 SELECT CASE WHEN json_extract(NEW.reward_json,'$.kind')='external' AND NOT EXISTS(
 SELECT 1 FROM external_redemption_attempts a WHERE a.id=NEW.id AND a.state='sending' AND a.code_id=NEW.code_id AND a.user_id=NEW.user_id AND a.reward_json=NEW.reward_json
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;

-- 已釋放名額的嘗試要重試時，重新確認名額與持有人，避免碼已交給別人或用完後仍重送。
CREATE TRIGGER external_attempt_released_retry BEFORE UPDATE OF state ON external_redemption_attempts
WHEN NEW.state='sending' AND OLD.state='retryable' AND OLD.review_required=0 BEGIN
 SELECT CASE WHEN (SELECT use_count+(SELECT count(*) FROM external_redemption_attempts WHERE code_id=NEW.code_id AND state!='applied' AND NOT (state='retryable' AND review_required=0) AND id!=NEW.id) FROM codes WHERE id=NEW.code_id)>=(SELECT max_uses FROM codes WHERE id=NEW.code_id)
  OR (EXISTS(SELECT 1 FROM code_batches b JOIN codes c ON c.batch_id=b.id WHERE c.id=NEW.code_id AND b.distribution_mode='unique')
   AND EXISTS(SELECT 1 FROM orders WHERE code_id=NEW.code_id AND (user_id IS NULL OR user_id!=NEW.user_id)))
 THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;

-- 4. 管理員核對外部已發放（outcome=applied）時，碼可能已到期、撤銷或商品已封存；
--    外部權益已經存在，本地必須能記錄，之後才能追蹤撤銷。只對有 applied 審查的嘗試放行。
DROP TRIGGER external_attempt_retry;
CREATE TRIGGER external_attempt_retry BEFORE UPDATE OF state ON external_redemption_attempts WHEN NEW.state='sending' AND NOT EXISTS(SELECT 1 FROM external_redemption_reviews r WHERE r.attempt_id=NEW.id AND r.outcome='applied') BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='redemption' AND p.archived_at IS NULL
   AND c.status IN ('available','assigned') AND c.use_count<c.max_uses AND (c.expires_at IS NULL OR c.expires_at>NEW.updated_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND user_id IS NOT NULL AND user_id!=NEW.user_id))
    OR (b.distribution_mode='shared' AND ((NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id) AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id))
     OR EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
     OR EXISTS(SELECT 1 FROM orders WHERE code_id=c.id AND user_id=NEW.user_id AND access_revoked_at IS NULL))))
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
END;
DROP TRIGGER redemption_validate;
CREATE TRIGGER redemption_validate BEFORE INSERT ON redemptions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM external_redemption_reviews r JOIN external_redemption_attempts a ON a.id=r.attempt_id
  WHERE r.attempt_id=NEW.id AND r.outcome='applied' AND a.state='sending' AND a.code_id=NEW.code_id AND a.user_id=NEW.user_id AND a.reward_json=NEW.reward_json)
 AND NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND b.kind='redemption' AND p.archived_at IS NULL
   AND c.status IN ('available','assigned') AND c.use_count<c.max_uses AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
   AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND user_id IS NOT NULL AND user_id!=NEW.user_id))
    OR (b.distribution_mode='shared' AND ((NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id) AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id))
     OR EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND (user_id=NEW.user_id OR user_id IS NULL))
     OR EXISTS(SELECT 1 FROM orders WHERE code_id=c.id AND user_id=NEW.user_id AND access_revoked_at IS NULL))))
 ) THEN RAISE(ABORT,'REDEMPTION_UNAVAILABLE') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM reward_rules r WHERE r.id=NEW.rule_id AND r.version=NEW.rule_version AND r.product_id=NEW.product_id AND r.reward_json=NEW.reward_json
   AND r.id=(SELECT rr.id FROM codes c JOIN code_batches b ON b.id=c.batch_id LEFT JOIN code_recipients cl ON cl.code_id=c.id AND (b.distribution_mode='unique' OR cl.user_id=NEW.user_id) JOIN reward_rules rr ON rr.batch_id=c.batch_id
    WHERE c.id=NEW.code_id AND (rr.campaign_id IS NULL OR rr.campaign_id=cl.campaign_id) ORDER BY rr.campaign_id IS NOT NULL DESC,cl.created_at,cl.id,rr.id LIMIT 1)
 ) AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.id=NEW.id AND a.state='sending' AND a.rule_id=NEW.rule_id AND a.rule_version=NEW.rule_version AND a.reward_json=NEW.reward_json AND a.code_id=NEW.code_id AND a.user_id=NEW.user_id)
 THEN RAISE(ABORT,'REWARD_CHANGED') END;
END;
-- 兌換消耗不能把已撤銷的碼改回 assigned。
DROP TRIGGER redemption_consume;
CREATE TRIGGER redemption_consume AFTER INSERT ON redemptions BEGIN
 UPDATE codes SET use_count=use_count+1,status=CASE WHEN status='revoked' THEN 'revoked' ELSE 'assigned' END WHERE id=NEW.code_id;
END;

-- 5. 匿名領取綁定帳號時同樣遵守每人上限；超過的紀錄跳過（維持匿名），不讓整個批次失敗。
CREATE TRIGGER claims_link_limit BEFORE UPDATE OF user_id ON claims
WHEN OLD.user_id IS NULL AND NEW.user_id IS NOT NULL BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM claims WHERE campaign_id=NEW.campaign_id AND user_id=NEW.user_id)
  >= (SELECT per_person_limit FROM campaigns WHERE id=NEW.campaign_id) THEN RAISE(IGNORE) END;
END;
