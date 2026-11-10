-- 記錄受委派的權杖；assigned_by 保留此單管理員部署的授權者。
ALTER TABLE code_assignments ADD COLUMN api_token_id TEXT REFERENCES api_tokens(id);
CREATE TRIGGER assignment_token_validate BEFORE INSERT ON code_assignments WHEN NEW.api_token_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM api_tokens t WHERE t.id=NEW.api_token_id AND t.revoked_at IS NULL
   AND (t.expires_at IS NULL OR t.expires_at>NEW.created_at)
   AND EXISTS(SELECT 1 FROM json_each(t.scopes_json) WHERE value='codes:issue')
   AND (t.products_json IS NULL OR EXISTS(SELECT 1 FROM json_each(t.products_json) WHERE value=NEW.product_id))
 ) THEN RAISE(ABORT,'API_SCOPE_DENIED') END;
END;
