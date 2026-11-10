-- 共用啟用碼依已驗證帳號的持有關係隔離裝置；獨立碼保留原協定。
DROP TRIGGER batch_shared_kind;
ALTER TABLE license_devices ADD COLUMN user_id TEXT REFERENCES "user"(id);
CREATE INDEX license_devices_owner ON license_devices(user_id,code_id,released_at);
CREATE VIEW license_holders AS
 SELECT code_id,user_id FROM claims WHERE user_id IS NOT NULL
 UNION SELECT code_id,user_id FROM orders WHERE code_id IS NOT NULL AND user_id IS NOT NULL AND access_revoked_at IS NULL;
DROP TRIGGER license_device_insert;
DROP TRIGGER license_device_reactivate;
CREATE TRIGGER license_device_insert BEFORE INSERT ON license_devices WHEN NEW.released_at IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND b.kind='license' AND p.archived_at IS NULL AND c.status IN ('available','assigned')
   AND (c.expires_at IS NULL OR c.expires_at>NEW.activated_at)
   AND ((b.distribution_mode='unique' AND NEW.user_id IS NULL)
    OR (b.distribution_mode='shared' AND NEW.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM license_holders h WHERE h.code_id=c.id AND h.user_id=NEW.user_id)))
   AND (SELECT COUNT(*) FROM license_devices WHERE code_id=c.id AND released_at IS NULL AND (b.distribution_mode='unique' OR user_id=NEW.user_id))<c.max_devices
 ) THEN RAISE(ABORT,'LICENSE_ACTIVATION_UNAVAILABLE') END;
END;
CREATE TRIGGER license_device_reactivate BEFORE UPDATE ON license_devices WHEN NEW.released_at IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND b.kind='license' AND p.archived_at IS NULL AND c.status IN ('available','assigned')
   AND (c.expires_at IS NULL OR c.expires_at>NEW.activated_at)
   AND ((b.distribution_mode='unique' AND NEW.user_id IS NULL)
    OR (b.distribution_mode='shared' AND NEW.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM license_holders h WHERE h.code_id=c.id AND h.user_id=NEW.user_id)))
   AND (SELECT COUNT(*) FROM license_devices WHERE code_id=c.id AND released_at IS NULL AND id!=NEW.id AND (b.distribution_mode='unique' OR user_id=NEW.user_id))<c.max_devices
 ) THEN RAISE(ABORT,'LICENSE_ACTIVATION_UNAVAILABLE') END;
END;
CREATE TRIGGER license_device_owner_immutable BEFORE UPDATE OF user_id,code_id,device_hash ON license_devices
WHEN NEW.user_id IS NOT OLD.user_id OR NEW.code_id!=OLD.code_id OR NEW.device_hash!=OLD.device_hash BEGIN
 SELECT RAISE(ABORT,'LICENSE_ACTIVATION_UNAVAILABLE');
END;
CREATE TRIGGER shared_license_claim_account BEFORE INSERT ON claims
WHEN EXISTS(SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id WHERE c.id=NEW.code_id AND b.kind='license' AND b.distribution_mode='shared')
AND (NEW.user_id IS NULL OR NOT EXISTS(SELECT 1 FROM "user" WHERE id=NEW.user_id)) BEGIN
 SELECT RAISE(ABORT,'CLAIM_LOGIN_REQUIRED');
END;
-- 退款後仍有其他合法持有來源時保留裝置，否則只解除該帳號的裝置。
CREATE TRIGGER order_refund_license_owner AFTER UPDATE OF access_revoked_at ON orders
WHEN OLD.access_revoked_at IS NULL AND NEW.access_revoked_at IS NOT NULL BEGIN
 UPDATE license_devices SET released_at=NEW.access_revoked_at
 WHERE code_id=NEW.code_id AND user_id=NEW.user_id AND released_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM license_holders h WHERE h.code_id=license_devices.code_id AND h.user_id=license_devices.user_id);
END;
