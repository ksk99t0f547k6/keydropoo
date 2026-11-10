ALTER TABLE code_batches ADD COLUMN request_key TEXT;
ALTER TABLE code_batches ADD COLUMN request_hash TEXT;
ALTER TABLE code_batches ADD COLUMN request_count INTEGER;
CREATE UNIQUE INDEX code_batches_request ON code_batches(product_id,request_key) WHERE request_key IS NOT NULL;
