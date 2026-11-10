-- 訪客紀錄綁定帳號後保留原匿名 subject；後續領取也計入帳號限額。
CREATE TRIGGER claims_account_limit BEFORE INSERT ON claims WHEN NEW.user_id IS NOT NULL BEGIN
 SELECT CASE WHEN (
  SELECT count(*) FROM claims WHERE campaign_id=NEW.campaign_id AND user_id=NEW.user_id
 ) >= (SELECT per_person_limit FROM campaigns WHERE id=NEW.campaign_id)
 THEN RAISE(ABORT,'CLAIM_UNAVAILABLE') END;
END;
