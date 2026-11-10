-- 商品圖示：圖片放獨立資料表（base64），商品列表只讀 icon_version 組網址，不必載入圖片本身。
ALTER TABLE products ADD COLUMN icon_version TEXT;
CREATE TABLE product_icons (
 product_id TEXT PRIMARY KEY REFERENCES products(id),
 content_type TEXT NOT NULL CHECK(content_type IN ('image/png','image/webp','image/jpeg')),
 data TEXT NOT NULL,
 width INTEGER NOT NULL CHECK(width BETWEEN 32 AND 1024),
 height INTEGER NOT NULL CHECK(height BETWEEN 32 AND 1024),
 updated_at INTEGER NOT NULL
);
