CREATE TABLE license_devices (
 id TEXT PRIMARY KEY,
 code_id TEXT NOT NULL REFERENCES codes(id),
 device_hash TEXT NOT NULL,
 label TEXT NOT NULL DEFAULT '',
 token_hash TEXT NOT NULL UNIQUE,
 token_ciphertext TEXT NOT NULL,
 activated_at INTEGER NOT NULL,
 released_at INTEGER,
 UNIQUE(code_id,device_hash)
);
CREATE INDEX license_devices_active ON license_devices(code_id,released_at);
CREATE TRIGGER license_device_insert BEFORE INSERT ON license_devices WHEN NEW.released_at IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND b.kind='license' AND p.archived_at IS NULL AND c.status IN ('available','assigned')
   AND (c.expires_at IS NULL OR c.expires_at>NEW.activated_at)
   AND (SELECT COUNT(*) FROM license_devices WHERE code_id=c.id AND released_at IS NULL)<c.max_devices
 ) THEN RAISE(ABORT,'LICENSE_ACTIVATION_UNAVAILABLE') END;
END;
CREATE TRIGGER license_device_reactivate BEFORE UPDATE ON license_devices WHEN NEW.released_at IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND b.kind='license' AND p.archived_at IS NULL AND c.status IN ('available','assigned')
   AND (c.expires_at IS NULL OR c.expires_at>NEW.activated_at)
   AND (SELECT COUNT(*) FROM license_devices WHERE code_id=c.id AND released_at IS NULL AND id!=NEW.id)<c.max_devices
 ) THEN RAISE(ABORT,'LICENSE_ACTIVATION_UNAVAILABLE') END;
END;
CREATE TRIGGER license_device_assign AFTER INSERT ON license_devices WHEN NEW.released_at IS NULL BEGIN
 UPDATE codes SET status='assigned' WHERE id=NEW.code_id;
END;
