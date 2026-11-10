CREATE TABLE credit_wallets (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id),
 user_id TEXT NOT NULL,
 bucket TEXT NOT NULL,
 balance INTEGER NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 9000000000000),
 created_at INTEGER NOT NULL,
 UNIQUE(product_id,user_id,bucket)
);
CREATE TABLE credit_operations (
 id TEXT PRIMARY KEY,
 wallet_id TEXT NOT NULL REFERENCES credit_wallets(id),
 idempotency_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('grant','spend','refund','revoke')),
 amount INTEGER NOT NULL CHECK(amount>=0 AND amount<=1000000000),
 related_id TEXT,
 balance_delta INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 UNIQUE(wallet_id,idempotency_key),
 CHECK((kind='revoke' AND amount=0) OR (kind!='revoke' AND amount>0))
);
CREATE INDEX credit_operations_history ON credit_operations(wallet_id,created_at,id);
CREATE TABLE credit_grants (
 id TEXT PRIMARY KEY REFERENCES credit_operations(id),
 wallet_id TEXT NOT NULL REFERENCES credit_wallets(id),
 source_id TEXT NOT NULL,
 granted INTEGER NOT NULL,
 available INTEGER NOT NULL CHECK(available>=0 AND available<=granted),
 revoked_at INTEGER,
 created_at INTEGER NOT NULL,
 UNIQUE(wallet_id,source_id)
);
CREATE INDEX credit_grants_available ON credit_grants(wallet_id,revoked_at,created_at,id);
CREATE TABLE credit_allocations (
 operation_id TEXT NOT NULL REFERENCES credit_operations(id),
 grant_id TEXT NOT NULL REFERENCES credit_grants(id),
 amount INTEGER NOT NULL CHECK(amount>0),
 PRIMARY KEY(operation_id,grant_id)
);

CREATE TRIGGER credit_validate BEFORE INSERT ON credit_operations BEGIN
 SELECT CASE WHEN NEW.kind='spend' AND NOT EXISTS(
  SELECT 1 FROM credit_wallets WHERE id=NEW.wallet_id AND balance>=NEW.amount
 ) THEN RAISE(ABORT,'INSUFFICIENT_CREDITS') END;
 SELECT CASE WHEN NEW.kind='refund' AND NOT EXISTS(
  SELECT 1 FROM credit_operations spend WHERE spend.id=NEW.related_id AND spend.wallet_id=NEW.wallet_id AND spend.kind='spend'
   AND NEW.amount<=spend.amount-COALESCE((SELECT SUM(amount) FROM credit_operations WHERE kind='refund' AND related_id=spend.id),0)
 ) THEN RAISE(ABORT,'INVALID_CREDIT_REFUND') END;
 SELECT CASE WHEN NEW.kind='revoke' AND NOT EXISTS(
  SELECT 1 FROM credit_grants WHERE id=NEW.related_id AND wallet_id=NEW.wallet_id AND revoked_at IS NULL
 ) THEN RAISE(ABORT,'INVALID_CREDIT_REVOCATION') END;
 SELECT CASE WHEN NEW.kind='grant' AND (NEW.related_id IS NULL OR length(NEW.related_id)=0) THEN RAISE(ABORT,'CREDIT_SOURCE_REQUIRED') END;
END;
CREATE TRIGGER credit_grant AFTER INSERT ON credit_operations WHEN NEW.kind='grant' BEGIN
 INSERT INTO credit_grants(id,wallet_id,source_id,granted,available,created_at) VALUES(NEW.id,NEW.wallet_id,NEW.related_id,NEW.amount,NEW.amount,NEW.created_at);
 UPDATE credit_wallets SET balance=balance+NEW.amount WHERE id=NEW.wallet_id;
 UPDATE credit_operations SET balance_delta=NEW.amount WHERE id=NEW.id;
END;
CREATE TRIGGER credit_spend AFTER INSERT ON credit_operations WHEN NEW.kind='spend' BEGIN
 INSERT INTO credit_allocations(operation_id,grant_id,amount)
 SELECT NEW.id,id,MIN(available,NEW.amount-prior) FROM (
  SELECT id,available,COALESCE(SUM(available) OVER(ORDER BY created_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior
  FROM credit_grants WHERE wallet_id=NEW.wallet_id AND revoked_at IS NULL AND available>0
 ) WHERE prior<NEW.amount;
 SELECT CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM credit_allocations WHERE operation_id=NEW.id)!=NEW.amount THEN RAISE(ABORT,'CREDIT_LEDGER_INCONSISTENT') END;
 UPDATE credit_grants SET available=available-(SELECT amount FROM credit_allocations WHERE operation_id=NEW.id AND grant_id=credit_grants.id)
 WHERE id IN(SELECT grant_id FROM credit_allocations WHERE operation_id=NEW.id);
 UPDATE credit_wallets SET balance=balance-NEW.amount WHERE id=NEW.wallet_id;
 UPDATE credit_operations SET balance_delta=-NEW.amount WHERE id=NEW.id;
END;
CREATE TRIGGER credit_refund AFTER INSERT ON credit_operations WHEN NEW.kind='refund' BEGIN
 INSERT INTO credit_allocations(operation_id,grant_id,amount)
 SELECT NEW.id,grant_id,MIN(remaining,NEW.amount-prior) FROM (
  SELECT grant_id,remaining,COALESCE(SUM(remaining) OVER(ORDER BY grant_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior FROM (
   SELECT a.grant_id,a.amount-COALESCE((SELECT SUM(r.amount) FROM credit_allocations r JOIN credit_operations o ON o.id=r.operation_id WHERE o.kind='refund' AND o.related_id=NEW.related_id AND r.grant_id=a.grant_id),0) AS remaining
   FROM credit_allocations a WHERE a.operation_id=NEW.related_id
  ) WHERE remaining>0
 ) WHERE prior<NEW.amount;
 SELECT CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM credit_allocations WHERE operation_id=NEW.id)!=NEW.amount THEN RAISE(ABORT,'CREDIT_LEDGER_INCONSISTENT') END;
 UPDATE credit_grants SET available=available+(SELECT amount FROM credit_allocations WHERE operation_id=NEW.id AND grant_id=credit_grants.id)
 WHERE revoked_at IS NULL AND id IN(SELECT grant_id FROM credit_allocations WHERE operation_id=NEW.id);
 UPDATE credit_operations SET balance_delta=(SELECT COALESCE(SUM(a.amount),0) FROM credit_allocations a JOIN credit_grants g ON g.id=a.grant_id WHERE a.operation_id=NEW.id AND g.revoked_at IS NULL) WHERE id=NEW.id;
 UPDATE credit_wallets SET balance=balance+(SELECT balance_delta FROM credit_operations WHERE id=NEW.id) WHERE id=NEW.wallet_id;
END;
CREATE TRIGGER credit_revoke AFTER INSERT ON credit_operations WHEN NEW.kind='revoke' BEGIN
 UPDATE credit_operations SET balance_delta=-(SELECT available FROM credit_grants WHERE id=NEW.related_id) WHERE id=NEW.id;
 UPDATE credit_wallets SET balance=balance+(SELECT balance_delta FROM credit_operations WHERE id=NEW.id) WHERE id=NEW.wallet_id;
 UPDATE credit_grants SET available=0,revoked_at=NEW.created_at WHERE id=NEW.related_id;
END;
