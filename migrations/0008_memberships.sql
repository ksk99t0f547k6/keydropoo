CREATE TABLE membership_grants (
 id TEXT PRIMARY KEY REFERENCES redemptions(id),
 product_id TEXT NOT NULL REFERENCES products(id),
 user_id TEXT NOT NULL,
 plan TEXT NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER,
 revoked_at INTEGER,
 replaced_by TEXT REFERENCES redemptions(id),
 created_at INTEGER NOT NULL,
 CHECK(ends_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX membership_grants_owner ON membership_grants(product_id,user_id,plan,starts_at,ends_at);
CREATE TRIGGER redemption_membership AFTER INSERT ON redemptions
WHEN json_extract(NEW.reward_json,'$.kind') IN ('membership','permanent') BEGIN
 SELECT CASE WHEN json_extract(NEW.reward_json,'$.repeat')='reject' AND EXISTS(
  SELECT 1 FROM membership_grants WHERE product_id=NEW.product_id AND user_id=NEW.user_id AND plan=json_extract(NEW.reward_json,'$.plan')
   AND revoked_at IS NULL AND (ends_at IS NULL OR ends_at>NEW.created_at)
 ) THEN RAISE(ABORT,'REWARD_ALREADY_OWNED') END;
 UPDATE membership_grants SET revoked_at=NEW.created_at,replaced_by=NEW.id
 WHERE json_extract(NEW.reward_json,'$.repeat')='replace' AND product_id=NEW.product_id AND user_id=NEW.user_id
  AND plan=json_extract(NEW.reward_json,'$.plan') AND revoked_at IS NULL AND (ends_at IS NULL OR ends_at>NEW.created_at);
 INSERT INTO membership_grants(id,product_id,user_id,plan,starts_at,ends_at,created_at)
 SELECT NEW.id,NEW.product_id,NEW.user_id,json_extract(NEW.reward_json,'$.plan'),start_time,
 CASE WHEN json_extract(NEW.reward_json,'$.kind')='permanent' THEN NULL ELSE start_time+json_extract(NEW.reward_json,'$.days')*86400000 END,NEW.created_at
 FROM (SELECT CASE WHEN json_extract(NEW.reward_json,'$.kind')='membership' AND json_extract(NEW.reward_json,'$.repeat')='add'
  THEN MAX(NEW.created_at,COALESCE((SELECT MAX(ends_at) FROM membership_grants WHERE product_id=NEW.product_id AND user_id=NEW.user_id
   AND plan=json_extract(NEW.reward_json,'$.plan') AND revoked_at IS NULL),NEW.created_at)) ELSE NEW.created_at END AS start_time);
END;
CREATE TRIGGER redemption_revoke_membership AFTER UPDATE OF revoked_at ON redemptions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND json_extract(NEW.reward_json,'$.kind') IN ('membership','permanent') AND json_extract(NEW.reward_json,'$.reclaimOnRevoke')=1 BEGIN
 UPDATE membership_grants SET revoked_at=NEW.revoked_at WHERE id=NEW.id AND revoked_at IS NULL;
END;
