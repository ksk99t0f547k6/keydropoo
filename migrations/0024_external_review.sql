-- 結果不明保留名額，使用者不可重送；明確拒絕才允許自行重試。
ALTER TABLE external_redemption_attempts ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN(0,1));
-- 舊版失敗沒有區分拒絕與未知結果，保守交由管理員確認。
UPDATE external_redemption_attempts SET review_required=1 WHERE state='retryable';
CREATE TABLE external_redemption_reviews (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES external_redemption_attempts(id),
 admin_id TEXT NOT NULL, note TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN('applied','not_applied')), created_at INTEGER NOT NULL
);
CREATE TRIGGER external_attempt_review_guard BEFORE UPDATE OF state ON external_redemption_attempts
WHEN NEW.state='sending' AND NEW.review_required=1 BEGIN
 SELECT RAISE(ABORT,'EXTERNAL_REDEMPTION_REVIEW_REQUIRED');
END;
