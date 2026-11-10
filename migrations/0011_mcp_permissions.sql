ALTER TABLE api_tokens ADD COLUMN mcp_write_enabled INTEGER NOT NULL DEFAULT 0 CHECK(mcp_write_enabled IN (0,1));
