// 控制台首頁的彙總數字。只讀查詢，不含碼原文或個資。
const DAY = 86400000;

export interface OverviewData {
  now: number;
  products: { active: number; archived: number };
  codes: { total: number; available: number };
  claims: { last30: number; today: number };
  orders: { paid30: number; review: number };
  revenue: { currency: string; netMinor: number }[];
  daily: { day: number; claims: number; orders: number }[];
  recent: { kind: "claim" | "order"; id: string; productId: string; productName: string; label: string | null; at: number; status: string | null }[];
  attention: { notifications: number; reviews: number; revocations: number; orders: number };
  setup: { product: boolean; codes: boolean; campaign: boolean };
}

export async function readOverview(db: D1Database, now = Date.now(), days = 14): Promise<OverviewData> {
  const today = Math.floor(now / DAY) * DAY;
  const since30 = now - 30 * DAY;
  const start = today - (days - 1) * DAY;
  const [counts, revenue, claimDays, orderDays, recent] = await Promise.all([
    db.prepare(`SELECT
      (SELECT count(*) FROM products WHERE archived_at IS NULL) AS active_products,
      (SELECT count(*) FROM products WHERE archived_at IS NOT NULL) AS archived_products,
      (SELECT count(*) FROM codes) AS total_codes,
      (SELECT count(*) FROM codes WHERE status='available') AS available_codes,
      (SELECT count(*) FROM claims WHERE created_at>=?) AS claims30,
      (SELECT count(*) FROM claims WHERE created_at>=?) AS claims_today,
      (SELECT count(*) FROM orders WHERE paid_at>=?) AS paid30,
      (SELECT count(*) FROM orders WHERE review_required=1) AS review_orders,
      (SELECT count(*) FROM admin_notifications WHERE resolved_at IS NULL) AS notifications,
      (SELECT count(*) FROM external_redemption_attempts WHERE review_required=1) AS reviews,
      (SELECT count(*) FROM external_revocations WHERE status='failed') AS revocations,
      (SELECT count(*) FROM campaigns WHERE status='active') AS active_campaigns`)
      .bind(since30, today, since30)
      .first<Record<string, number>>(),
    db.prepare(`SELECT currency,sum(COALESCE(charged_minor,amount_minor)-refunded_minor) AS net FROM orders WHERE paid_at>=? GROUP BY currency ORDER BY net DESC`)
      .bind(since30)
      .all<{ currency: string; net: number }>(),
    db.prepare(`SELECT (created_at/${DAY})*${DAY} AS day,count(*) AS n FROM claims WHERE created_at>=? GROUP BY day`).bind(start).all<{ day: number; n: number }>(),
    db.prepare(`SELECT (paid_at/${DAY})*${DAY} AS day,count(*) AS n FROM orders WHERE paid_at>=? GROUP BY day`).bind(start).all<{ day: number; n: number }>(),
    db.prepare(`SELECT * FROM (
      SELECT 'claim' AS kind,c.id,p.id AS product_id,p.name AS product_name,k.name AS label,c.created_at AS at,NULL AS status FROM claims c JOIN campaigns k ON k.id=c.campaign_id JOIN products p ON p.id=k.product_id
      UNION ALL
      SELECT 'order',o.id,p.id,p.name,NULL,COALESCE(o.paid_at,o.created_at),o.status FROM orders o JOIN products p ON p.id=o.product_id WHERE o.status!='expired'
    ) ORDER BY at DESC,id LIMIT 8`).all<{ kind: "claim" | "order"; id: string; product_id: string; product_name: string; label: string | null; at: number; status: string | null }>(),
  ]);
  const c = counts ?? {};
  const byDay = (rows: { day: number; n: number }[]) => new Map(rows.map((row) => [Number(row.day), Number(row.n)]));
  const claimMap = byDay(claimDays.results), orderMap = byDay(orderDays.results);
  return {
    now,
    products: { active: c.active_products ?? 0, archived: c.archived_products ?? 0 },
    codes: { total: c.total_codes ?? 0, available: c.available_codes ?? 0 },
    claims: { last30: c.claims30 ?? 0, today: c.claims_today ?? 0 },
    orders: { paid30: c.paid30 ?? 0, review: c.review_orders ?? 0 },
    revenue: revenue.results.map((row) => ({ currency: row.currency, netMinor: Number(row.net) })),
    daily: Array.from({ length: days }, (_, index) => {
      const day = start + index * DAY;
      return { day, claims: claimMap.get(day) ?? 0, orders: orderMap.get(day) ?? 0 };
    }),
    recent: recent.results.map((row) => ({ kind: row.kind, id: row.id, productId: row.product_id, productName: row.product_name, label: row.label, at: row.at, status: row.status })),
    attention: { notifications: c.notifications ?? 0, reviews: c.reviews ?? 0, revocations: c.revocations ?? 0, orders: c.review_orders ?? 0 },
    setup: { product: (c.active_products ?? 0) + (c.archived_products ?? 0) > 0, codes: (c.total_codes ?? 0) > 0, campaign: (c.active_campaigns ?? 0) > 0 },
  };
}
