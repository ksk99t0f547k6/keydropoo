-- 郵件依收件人語言寄送：記住使用者偏好的介面語言，以及排隊郵件建立時的語言。
ALTER TABLE "user" ADD COLUMN locale TEXT;
ALTER TABLE guest_claim_emails ADD COLUMN locale TEXT;
ALTER TABLE email_distributions ADD COLUMN locale TEXT;
