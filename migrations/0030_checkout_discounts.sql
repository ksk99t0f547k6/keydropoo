ALTER TABLE products ADD COLUMN allow_promotion_codes INTEGER NOT NULL DEFAULT 0 CHECK(allow_promotion_codes IN (0,1));
