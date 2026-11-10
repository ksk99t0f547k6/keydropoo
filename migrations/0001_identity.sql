-- Better Auth 基礎資料表；時間統一使用毫秒。
CREATE TABLE "user" (
 id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT,
 createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE TABLE session (
 id TEXT PRIMARY KEY NOT NULL, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
 createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT,
 userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX session_user ON session(userId);
CREATE TABLE account (
 id TEXT PRIMARY KEY NOT NULL, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
 userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER,
 refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT,
 createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
 UNIQUE(providerId, accountId)
);
CREATE INDEX account_user ON account(userId);
CREATE TABLE verification (
 id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL,
 expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE INDEX verification_identifier ON verification(identifier);
CREATE TABLE rateLimit (id TEXT PRIMARY KEY NOT NULL, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, lastRequest INTEGER NOT NULL);
-- admin_user_id 不加外鍵，讓初始化 batch 可先鎖定單例再插入使用者。
CREATE TABLE installation (id INTEGER PRIMARY KEY CHECK(id = 1), admin_user_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
