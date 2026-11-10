CREATE TABLE webhook_endpoints (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 url TEXT NOT NULL,
 secret_name TEXT NOT NULL,
 events_json TEXT NOT NULL CHECK(json_valid(events_json)),
 products_json TEXT CHECK(products_json IS NULL OR json_valid(products_json)),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 created_at INTEGER NOT NULL
);
CREATE TABLE webhook_events (
 id TEXT PRIMARY KEY,
 type TEXT NOT NULL,
 product_id TEXT NOT NULL REFERENCES products(id),
 data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 created_at INTEGER NOT NULL
);
CREATE TABLE webhook_deliveries (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES webhook_events(id),
 endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','delivered','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 lease_token TEXT,
 lease_until INTEGER,
 last_status INTEGER,
 delivered_at INTEGER,
 UNIQUE(event_id,endpoint_id)
);
CREATE INDEX webhook_due ON webhook_deliveries(status,next_attempt_at);
CREATE TRIGGER webhook_fanout AFTER INSERT ON webhook_events BEGIN
 INSERT INTO webhook_deliveries(id,event_id,endpoint_id,next_attempt_at)
 SELECT lower(hex(randomblob(16))),NEW.id,e.id,NEW.created_at FROM webhook_endpoints e
 WHERE e.enabled=1 AND EXISTS(SELECT 1 FROM json_each(e.events_json) WHERE value=NEW.type)
 AND (e.products_json IS NULL OR EXISTS(SELECT 1 FROM json_each(e.products_json) WHERE value=NEW.product_id));
END;
CREATE TRIGGER event_claim AFTER INSERT ON claims BEGIN
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 SELECT 'claim:'||NEW.id,'code.claimed',c.product_id,
 json_object('claimId',NEW.id,'campaignId',NEW.campaign_id,'codeId',NEW.code_id,'userId',NEW.user_id),NEW.created_at
 FROM campaigns c WHERE c.id=NEW.campaign_id;
END;
CREATE TRIGGER event_redemption AFTER INSERT ON redemptions BEGIN
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 VALUES('redemption:'||NEW.id,'code.redeemed',NEW.product_id,
 json_object('redemptionId',NEW.id,'codeId',NEW.code_id,'userId',NEW.user_id),NEW.created_at);
END;
CREATE TRIGGER event_code_revoke AFTER UPDATE OF status ON codes
WHEN NEW.status='revoked' AND OLD.status!='revoked' BEGIN
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 VALUES(lower(hex(randomblob(16))),'code.revoked',NEW.product_id,json_object('codeId',NEW.id),CAST(strftime('%s','now') AS INTEGER)*1000);
END;
CREATE TRIGGER event_order_delivered AFTER UPDATE OF status ON orders
WHEN NEW.status='fulfilled' AND OLD.status!='fulfilled' BEGIN
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 VALUES('delivery:'||NEW.id,'order.delivered',NEW.product_id,
 json_object('orderId',NEW.id,'codeId',NEW.code_id,'userId',NEW.user_id),NEW.updated_at);
END;
CREATE TRIGGER event_order_refund AFTER UPDATE OF refunded_minor ON orders
WHEN NEW.refunded_minor>OLD.refunded_minor BEGIN
 INSERT INTO webhook_events(id,type,product_id,data_json,created_at)
 VALUES('refund:'||NEW.id||':'||NEW.refunded_minor,'order.refunded',NEW.product_id,
 json_object('orderId',NEW.id,'refundedMinor',NEW.refunded_minor,'amountMinor',NEW.amount_minor,'currency',NEW.currency),NEW.updated_at);
END;
