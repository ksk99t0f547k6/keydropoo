-- 管理員手動發放：在手機上取一個碼，傳給沒有 Keydrop 帳號的人（例如 App Store 兌換碼），
-- 收件人只是一行文字，可以之後補填；撤回會把碼放回庫存。
CREATE TABLE code_handouts (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id),
 code_id TEXT NOT NULL REFERENCES codes(id),
 handed_by TEXT NOT NULL REFERENCES "user"(id),
 idempotency_key TEXT NOT NULL,
 recipient TEXT CHECK(recipient IS NULL OR length(recipient) BETWEEN 1 AND 200),
 channel TEXT CHECK(channel IS NULL OR length(channel) BETWEEN 1 AND 40),
 note TEXT CHECK(note IS NULL OR length(note) BETWEEN 1 AND 1000),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 undone_at INTEGER,
 UNIQUE(handed_by,idempotency_key)
);
-- 同一個碼同時只能有一筆有效發放。
CREATE UNIQUE INDEX code_handouts_active ON code_handouts(code_id) WHERE undone_at IS NULL;
CREATE INDEX code_handouts_recent ON code_handouts(product_id,created_at);
CREATE INDEX code_handouts_created ON code_handouts(created_at);

-- 只能發放獨立碼（unique），而且要真的可用：沒被領、賣、指派、在途外部兌換或 Stripe 停用。
CREATE TRIGGER handout_validate BEFORE INSERT ON code_handouts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM installation WHERE id=1 AND admin_user_id=NEW.handed_by)
 THEN RAISE(ABORT,'HANDOUT_FORBIDDEN') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
  WHERE c.id=NEW.code_id AND c.product_id=NEW.product_id AND p.archived_at IS NULL
   AND b.distribution_mode='unique' AND c.status='available' AND c.use_count=0
   AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
   AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts WHERE code_id=c.id AND state!='applied')
   AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id OR (reserved_code_id=c.id AND status='pending'))
 ) THEN RAISE(ABORT,'HANDOUT_UNAVAILABLE') END;
END;
CREATE TRIGGER handout_allocate AFTER INSERT ON code_handouts BEGIN
 UPDATE codes SET status='assigned' WHERE id=NEW.code_id AND status='available';
END;
-- 發放紀錄只能改收件人、管道、備註與撤回時間；碼與發放者不可改，撤回後不能復原。
CREATE TRIGGER handout_immutable BEFORE UPDATE ON code_handouts BEGIN
 SELECT CASE WHEN NEW.id!=OLD.id OR NEW.code_id!=OLD.code_id OR NEW.product_id!=OLD.product_id OR NEW.handed_by!=OLD.handed_by
  OR NEW.idempotency_key!=OLD.idempotency_key OR NEW.created_at!=OLD.created_at OR (OLD.undone_at IS NOT NULL AND NEW.undone_at IS NOT OLD.undone_at)
 THEN RAISE(ABORT,'HANDOUT_IMMUTABLE') END;
END;
-- 撤回：碼若沒被兌換或交給別人，放回可用；已撤銷的碼保持撤銷。
CREATE TRIGGER handout_undo AFTER UPDATE OF undone_at ON code_handouts WHEN OLD.undone_at IS NULL AND NEW.undone_at IS NOT NULL BEGIN
 UPDATE codes SET status='available' WHERE id=NEW.code_id AND status='assigned' AND use_count=0
  AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=NEW.code_id)
  AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=NEW.code_id);
END;
