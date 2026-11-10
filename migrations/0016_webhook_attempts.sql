ALTER TABLE webhook_deliveries ADD COLUMN total_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_deliveries ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
UPDATE webhook_deliveries SET total_attempts=attempts;
