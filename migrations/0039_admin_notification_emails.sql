-- 每個通知版本獨立去重；不保存 Email、外部錯誤本文或原始碼。
CREATE TABLE admin_notification_emails (
 notification_id TEXT NOT NULL REFERENCES admin_notifications(id),
 occurrence INTEGER NOT NULL CHECK(occurrence>0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 next_attempt_at INTEGER NOT NULL,
 lease_token TEXT,
 lease_until INTEGER,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(notification_id,occurrence)
);
CREATE INDEX admin_notification_emails_due ON admin_notification_emails(status,next_attempt_at);
