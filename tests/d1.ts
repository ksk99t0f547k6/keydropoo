import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// 用真正 SQLite 驗證 SQL 與 batch 回滾，不模擬成功結果。
export function testDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001_identity.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0002_inventory.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0003_campaigns.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0004_claims.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0005_claim_rate_limits.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0006_credit_ledger.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0007_redemptions.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0008_memberships.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0009_license_devices.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0010_api_tokens.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0011_mcp_permissions.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0012_orders.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0013_stripe.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0014_stock_additions.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0015_event_outbox.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0016_webhook_attempts.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0017_batch_requests.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0018_code_email.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0019_shared_claims.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0020_shared_orders.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0021_shared_licenses.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0022_external_redemptions.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0023_external_revocations.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0024_external_review.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0025_stripe_discount_catalog.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0026_stripe_discount_operations.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0027_stripe_inventory.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0028_stripe_sync.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0029_order_charges.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0030_checkout_discounts.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0031_stripe_product.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0032_stripe_exports.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0033_claim_account_links.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0034_direct_assignments.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0035_assignment_tokens.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0036_email_distributions.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0037_email_distribution_retries.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0038_email_distribution_owners.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0039_admin_notification_emails.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0040_order_refund_reviews.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0041_guest_claim_emails.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0042_review_fixes.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0043_code_handouts.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0044_locales.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0045_product_icons.sql", import.meta.url), "utf8"));
  const prepare = (sql: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    async first(column?: string) {
      const row = sqlite.prepare(sql).get(...args as never[]) as Record<string, unknown> | undefined;
      return column ? row?.[column] ?? null : row ?? null;
    },
    async all() {
      const before = Number(sqlite.prepare("SELECT total_changes() AS n").get()!.n);
      const results = sqlite.prepare(sql).all(...args as never[]);
      const changes = Number(sqlite.prepare("SELECT total_changes() AS n").get()!.n) - before;
      return { results, success: true, meta: { changes } };
    },
    async run() {
      // D1 的 meta.changes 包含觸發器寫入；不能以 SQLite 單一陳述的 changes 代替。
      const before = Number(sqlite.prepare("SELECT total_changes() AS n").get()!.n);
      const result = sqlite.prepare(sql).run(...args as never[]);
      const changes = Number(sqlite.prepare("SELECT total_changes() AS n").get()!.n) - before;
      return { results: [], success: true, meta: { changes, last_row_id: Number(result.lastInsertRowid) } };
    },
    async raw() { return sqlite.prepare(sql).all(...args as never[]).map(Object.values); },
  });
  const db = {
    prepare,
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec("BEGIN");
      try { const result = []; for (const stmt of statements) result.push(await stmt.run()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
