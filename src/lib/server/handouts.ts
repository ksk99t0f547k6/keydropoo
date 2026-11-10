import { z } from "zod";
import { encryptionKey, openCode } from "../domain/codes";
import { productIconUrl } from "@/lib/domain/product-icon";

// 管理員手動發放：取一個碼（顯示即佔用）、補填收件人、撤回、查紀錄。
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const takeInput = z
  .object({
    productId: z.uuid(),
    batchId: z.uuid().nullable().optional(),
    idempotencyKey: z.uuid(),
    recipient: text(200),
    channel: text(40),
    note: text(1000),
  })
  .strict();

export const updateInput = z.object({ recipient: text(200), channel: text(40), note: text(1000) }).strict();

export const listInput = z
  .object({
    productId: z.uuid().optional(),
    query: z.string().trim().max(200).optional(),
    // 查詢字串的 "false" 不能用 z.coerce.boolean()（任何非空字串都會變成 true）。
    missingRecipient: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();

interface HandoutRow {
  id: string;
  product_id: string;
  product_name: string;
  product_icon_version: string | null;
  batch_name: string;
  code_id: string;
  ciphertext: string;
  code_status: string;
  expires_at: number | null;
  recipient: string | null;
  channel: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
  undone_at: number | null;
}

export interface Handout {
  id: string;
  productId: string;
  productName: string;
  /** 商品圖示網址（含版本），沒有上傳時為 null。 */
  productIcon: string | null;
  batchName: string;
  codeId: string;
  code: string;
  codeStatus: string;
  expiresAt: number | null;
  recipient: string | null;
  channel: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  undoneAt: number | null;
}

const SELECT = `SELECT h.id,h.product_id,p.name AS product_name,p.icon_version AS product_icon_version,b.name AS batch_name,h.code_id,c.ciphertext,c.status AS code_status,c.expires_at,
 h.recipient,h.channel,h.note,h.created_at,h.updated_at,h.undone_at
 FROM code_handouts h JOIN codes c ON c.id=h.code_id JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=h.product_id`;

async function present(rows: HandoutRow[], secret: string): Promise<Handout[]> {
  const key = await encryptionKey(secret);
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      productIcon: productIconUrl(row.product_id, row.product_icon_version),
      batchName: row.batch_name,
      codeId: row.code_id,
      code: await openCode(row.ciphertext, key, `${row.product_id}:${row.code_id}`),
      codeStatus: row.code_status,
      expiresAt: row.expires_at,
      recipient: row.recipient,
      channel: row.channel,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      undoneAt: row.undone_at,
    })),
  );
}

async function byKey(db: D1Database, adminId: string, key: string) {
  return db.prepare(`${SELECT} WHERE h.handed_by=? AND h.idempotency_key=?`).bind(adminId, key).first<HandoutRow>();
}

// 原子地挑一個可用碼並記成已發放；先挑最早到期的，避免兌換碼放到過期。
export async function takeCode(db: D1Database, secret: string, adminId: string, raw: unknown, now = Date.now(), attempt = 0): Promise<Handout> {
  const input = takeInput.parse(raw);
  const replay = await byKey(db, adminId, input.idempotencyKey);
  if (replay) {
    if (replay.product_id !== input.productId) throw new Error("HANDOUT_IDEMPOTENCY_CONFLICT");
    return (await present([replay], secret))[0];
  }
  const id = crypto.randomUUID();
  try {
    const result = await db
      .prepare(
        `INSERT INTO code_handouts(id,product_id,code_id,handed_by,idempotency_key,recipient,channel,note,created_at,updated_at)
 SELECT ?,c.product_id,c.id,?,?,?,?,?,?,? FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
 WHERE c.product_id=? AND (? IS NULL OR c.batch_id=?) AND p.archived_at IS NULL AND b.distribution_mode='unique' AND c.status='available' AND c.use_count=0
  AND (c.expires_at IS NULL OR c.expires_at>?)
  AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts WHERE code_id=c.id AND state!='applied')
  AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM orders WHERE code_id=c.id)
 ORDER BY c.expires_at IS NULL,c.expires_at,c.created_at,c.id LIMIT 1`,
      )
      .bind(id, adminId, input.idempotencyKey, input.recipient ?? null, input.channel ?? null, input.note ?? null, now, now, input.productId, input.batchId ?? null, input.batchId ?? null, now)
      .run();
    if (!result.meta.changes) throw new Error("HANDOUT_UNAVAILABLE");
  } catch (error) {
    // 另一個相同冪等鍵的請求可能已完成；沒有的話，兩台裝置同時搶到同一碼時重新挑一次。
    const again = await byKey(db, adminId, input.idempotencyKey);
    if (again) return (await present([again], secret))[0];
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") && message.includes("code_handouts") && attempt < 3) return takeCode(db, secret, adminId, raw, now, attempt + 1);
    if (message.includes("HANDOUT_FORBIDDEN")) throw new Error("HANDOUT_FORBIDDEN");
    throw new Error("HANDOUT_UNAVAILABLE");
  }
  return (await present([(await byKey(db, adminId, input.idempotencyKey))!], secret))[0];
}

export async function updateHandout(db: D1Database, secret: string, id: string, raw: unknown, now = Date.now()) {
  z.uuid().parse(id);
  const input = updateInput.parse(raw);
  const result = await db
    .prepare("UPDATE code_handouts SET recipient=?,channel=?,note=?,updated_at=? WHERE id=? AND undone_at IS NULL")
    .bind(input.recipient ?? null, input.channel ?? null, input.note ?? null, now, id)
    .run();
  if (!result.meta.changes) throw new Error("HANDOUT_NOT_FOUND");
  return getHandout(db, secret, id);
}

export async function undoHandout(db: D1Database, secret: string, id: string, now = Date.now()) {
  z.uuid().parse(id);
  await db.prepare("UPDATE code_handouts SET undone_at=?,updated_at=? WHERE id=? AND undone_at IS NULL").bind(now, now, id).run();
  const handout = await getHandout(db, secret, id);
  if (!handout) throw new Error("HANDOUT_NOT_FOUND");
  return handout;
}

export async function getHandout(db: D1Database, secret: string, id: string) {
  const row = await db.prepare(`${SELECT} WHERE h.id=?`).bind(id).first<HandoutRow>();
  return row ? (await present([row], secret))[0] : null;
}

export async function listHandouts(db: D1Database, secret: string, raw: unknown) {
  const input = listInput.parse(raw);
  const clauses = ["h.undone_at IS NULL"];
  const args: (string | number)[] = [];
  if (input.productId) {
    clauses.push("h.product_id=?");
    args.push(input.productId);
  }
  if (input.missingRecipient) clauses.push("h.recipient IS NULL");
  if (input.query) {
    const pattern = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push("(h.recipient LIKE ? ESCAPE '\\' OR h.note LIKE ? ESCAPE '\\' OR h.channel LIKE ? ESCAPE '\\')");
    args.push(pattern, pattern, pattern);
  }
  const { results } = await db
    .prepare(`${SELECT} WHERE ${clauses.join(" AND ")} ORDER BY h.created_at DESC,h.id LIMIT 21 OFFSET ?`)
    .bind(...args, (input.page - 1) * 20)
    .all<HandoutRow>();
  return { items: await present(results.slice(0, 20), secret), hasMore: results.length > 20, page: input.page };
}

// 手機取碼頁的選項：每個商品裡可以手動發放的獨立碼批次與剩餘數量。
export async function handoutSources(db: D1Database, now = Date.now()) {
  const { results } = await db
    .prepare(
      `SELECT p.id AS product_id,p.name AS product_name,p.icon_version,b.id AS batch_id,b.name AS batch_name,b.kind,
  (SELECT count(*) FROM codes c WHERE c.batch_id=b.id AND c.status='available' AND c.use_count=0 AND (c.expires_at IS NULL OR c.expires_at>?)
    AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id)) AS available
 FROM code_batches b JOIN products p ON p.id=b.product_id
 WHERE p.archived_at IS NULL AND b.distribution_mode='unique' ORDER BY p.name,p.id,b.created_at,b.id`,
    )
    .bind(now)
    .all<{ product_id: string; product_name: string; icon_version: string | null; batch_id: string; batch_name: string; kind: string; available: number }>();
  const products = new Map<string, { id: string; name: string; icon: string | null; batches: { id: string; name: string; kind: string; available: number }[] }>();
  for (const row of results) {
    const product = products.get(row.product_id) ?? { id: row.product_id, name: row.product_name, icon: productIconUrl(row.product_id, row.icon_version), batches: [] };
    product.batches.push({ id: row.batch_id, name: row.batch_name, kind: row.kind, available: Number(row.available) });
    products.set(row.product_id, product);
  }
  return [...products.values()];
}
