import { currencyDigits } from "../domain/money";
import { z } from "zod";
import { encryptionKey, fingerprint, sealCode } from "../domain/codes";

export const productInput = z.object({
 name: z.string().trim().min(1).max(120), slug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
 description: z.string().max(2000).default(""), currency: z.string().regex(/^[A-Z]{3}$/).refine((v)=>{try{currencyDigits(v);return true;}catch{return false;}}).default("USD"),
 priceMinor: z.number().int().min(0).max(99999999).default(0),
 shortagePolicy: z.enum(["refund", "manual", "backorder"]).default("refund"), revokeOnRefund: z.boolean().default(true),
});
export async function createProduct(db: D1Database, raw: unknown) {
 const input = productInput.parse(raw); const id = crypto.randomUUID(); const now = Date.now();
 await db.prepare("INSERT INTO products (id,name,slug,description,currency,price_minor,shortage_policy,revoke_on_refund,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
  .bind(id,input.name,input.slug,input.description,input.currency,input.priceMinor,input.shortagePolicy,Number(input.revokeOnRefund),now,now).run();
 return { id, ...input };
}
export const batchInput = z.object({
 productId: z.string().uuid(), name: z.string().trim().min(1).max(120),
 kind: z.enum(["redemption", "discount", "license", "external"]), source: z.enum(["generated", "manual", "import", "stripe"]),
 distributionMode: z.enum(["unique","shared"]).default("unique"), sharedClaimLimit:z.number().int().min(1).max(1000000).nullable().default(null),
 codes: z.array(z.string().min(1).max(512).refine((s) => s === s.trim() && !/[\r\n\u0000]/.test(s))).min(1).max(1000),
 expiresAt: z.number().int().positive().nullable().default(null), maxUses: z.number().int().min(1).max(1000000).default(1), maxDevices: z.number().int().min(1).max(10000).default(1),
});
export async function createBatch(db: D1Database, secret: string, raw: unknown, request?:{key:string;hash:string}) {
 const input = batchInput.parse(raw);
 async function replay(){
  if(!request)return null;
  z.uuid().parse(request.key);z.string().regex(/^[a-f0-9]{64}$/).parse(request.hash);
  const row=await db.prepare("SELECT b.id,b.request_hash,b.request_count AS count FROM code_batches b WHERE b.product_id=? AND b.request_key=?").bind(input.productId,request.key).first<{id:string;request_hash:string;count:number}>();
  if(row&&row.request_hash!==request.hash)throw new Error("BATCH_IDEMPOTENCY_CONFLICT");
  return row?{id:row.id,count:row.count}:null;
 }
 const previous=await replay();if(previous)return previous;
 if (new Set(input.codes).size !== input.codes.length) throw new Error("DUPLICATE_CODES");
 const product = await db.prepare("SELECT id FROM products WHERE id = ? AND archived_at IS NULL").bind(input.productId).first();
 if (!product) throw new Error("PRODUCT_NOT_FOUND");
 const key = await encryptionKey(secret); const batchId = crypto.randomUUID(); const now = Date.now();
 const rows = await Promise.all(input.codes.map(async (code) => {
   const id = crypto.randomUUID();
   return { id, fingerprint: await fingerprint(code), ciphertext: await sealCode(code,key,`${input.productId}:${id}`) };
 }));
 // 整批入庫保留交易語意，重複碼使批次一併回滾。
 try{await db.batch([
   db.prepare("INSERT INTO code_batches (id,product_id,name,kind,source,created_at,request_key,request_hash,request_count,distribution_mode,shared_claim_limit) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(batchId,input.productId,input.name,input.kind,input.source,now,request?.key??null,request?.hash??null,request?input.codes.length:null,input.distributionMode,input.sharedClaimLimit),
   db.prepare("INSERT INTO codes (id,product_id,batch_id,fingerprint,ciphertext,expires_at,max_uses,max_devices,created_at) SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.fingerprint'), json_extract(value, '$.ciphertext'), ?, ?, ?, ? FROM json_each(?)")
     .bind(input.productId,batchId,input.expiresAt,input.maxUses,input.maxDevices,now,JSON.stringify(rows)),
 ]);}catch(error){const existing=await replay();if(existing)return existing;throw error;}
 return { id: batchId, count: rows.length };
}

export const inventoryQuery = z.object({
 productId: z.string().uuid(), batchId: z.string().uuid().optional(),
 status: z.enum(["available","reserved","assigned","revoked"]).optional(),
 code: z.string().max(512).optional(), page: z.coerce.number().int().min(1).max(100000).default(1),
 pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export interface CodeRow {
 id: string; product_id: string; batch_id: string; batch_name: string; kind: string;
 source:string; stripe_linked:number; stripe_export_operation_id:string|null; source_unavailable:number; status: string; expires_at: number | null; max_uses: number; use_count: number;
 max_devices: number; created_at: number;
}
export async function listCodes(db: D1Database, raw: unknown) {
 const q = inventoryQuery.parse(raw);
 const conditions = ["c.product_id = ?"]; const args: (string | number)[] = [q.productId];
 if (q.batchId) { conditions.push("c.batch_id = ?"); args.push(q.batchId); }
 if (q.status) { conditions.push("c.status = ?"); args.push(q.status); }
 if (q.code) { conditions.push("c.fingerprint = ?"); args.push(await fingerprint(q.code)); }
 const where = conditions.join(" AND ");
 const count = await db.prepare(`SELECT count(*) AS total FROM codes c WHERE ${where}`).bind(...args).first<{total:number}>();
 const { results } = await db.prepare(`SELECT EXISTS(SELECT 1 FROM stripe_inventory_links WHERE code_id=c.id) AS stripe_linked,(SELECT operation_id FROM stripe_inventory_exports WHERE code_id=c.id) AS stripe_export_operation_id,EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id) AS source_unavailable,c.id,c.product_id,c.batch_id,b.name AS batch_name,b.kind,b.source,c.status,c.expires_at,c.max_uses,c.use_count,c.max_devices,c.created_at FROM codes c JOIN code_batches b ON b.id=c.batch_id WHERE ${where} ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?`).bind(...args,q.pageSize,(q.page-1)*q.pageSize).all<CodeRow>();
 return { codes: results, total:count?.total ?? 0, page:q.page, pageSize:q.pageSize };
}
export async function changeCodeStatus(db: D1Database, raw: unknown) {
 const input = z.object({ productId:z.string().uuid(), ids:z.array(z.string().uuid()).min(1).max(1000), action:z.enum(["revoke","restore"]) }).parse(raw);
 const sql = input.action === "revoke"
  ? "UPDATE codes SET previous_status=status,status='revoked' WHERE product_id=? AND id IN (SELECT value FROM json_each(?)) AND status IN ('available','reserved','assigned')"
  : "UPDATE codes SET status=previous_status,previous_status=NULL WHERE product_id=? AND id IN (SELECT value FROM json_each(?)) AND status='revoked' AND previous_status IS NOT NULL";
 // D1 的 meta.changes 也計入事件觸發器，只以直接更新的碼列計數。
 const {results} = await db.prepare(`${sql} RETURNING id`).bind(input.productId,JSON.stringify(input.ids)).all<{id:string}>();
 return { changed:results.length };
}
export async function exportCodes(db: D1Database, secret: string, raw: unknown) {
 const input = z.object({ productId:z.string().uuid(), batchId:z.string().uuid() }).parse(raw);
 const { results } = await db.prepare("SELECT id,product_id,ciphertext,status,expires_at FROM codes WHERE product_id=? AND batch_id=? ORDER BY created_at,id LIMIT 1001").bind(input.productId,input.batchId).all<{id:string;product_id:string;ciphertext:string;status:string;expires_at:number|null}>();
 if (results.length > 1000) throw new Error("EXPORT_TOO_LARGE");
 const key = await encryptionKey(secret);
 const { openCode } = await import("../domain/codes");
 return Promise.all(results.map(async (r) => ({ code:await openCode(r.ciphertext,key,`${r.product_id}:${r.id}`),status:r.status,expiresAt:r.expires_at })));
}
export async function listBatches(db: D1Database, productId: string) {
 z.string().uuid().parse(productId);
 const { results } = await db.prepare("SELECT b.id,b.name,b.kind,b.source,b.distribution_mode,b.shared_claim_limit,b.created_at,COUNT(c.id) AS count FROM code_batches b LEFT JOIN codes c ON c.batch_id=b.id WHERE b.product_id=? GROUP BY b.id ORDER BY b.created_at DESC,b.id").bind(productId).all<{id:string;name:string;kind:string;source:string;distribution_mode:"unique"|"shared";shared_claim_limit:number|null;created_at:number;count:number}>();
 return results;
}

export interface ProductRow {
 id:string;name:string;slug:string;description:string;currency:string;price_minor:number;checkout_batch_id:string|null;allow_promotion_codes:number;stripe_product_id:string|null;
 shortage_policy:"refund"|"manual"|"backorder";revoke_on_refund:number;archived_at:number|null;created_at:number;updated_at:number;code_count?:number;icon_version?:string|null;
}
export async function updateProduct(db:D1Database,id:string,raw:unknown) {
 z.string().uuid().parse(id);const input=productInput.parse(raw);
 const r=await db.prepare("UPDATE products SET name=?,slug=?,description=?,currency=?,price_minor=?,shortage_policy=?,revoke_on_refund=?,updated_at=? WHERE id=?")
 .bind(input.name,input.slug,input.description,input.currency,input.priceMinor,input.shortagePolicy,Number(input.revokeOnRefund),Date.now(),id).run();
 if(!r.meta.changes)throw new Error("PRODUCT_NOT_FOUND");return {id,...input};
}
export async function archiveProduct(db:D1Database,id:string,archived:boolean) {
 z.string().uuid().parse(id);const r=await db.prepare("UPDATE products SET archived_at=?,updated_at=? WHERE id=?").bind(archived?Date.now():null,Date.now(),id).run();
 if(!r.meta.changes)throw new Error("PRODUCT_NOT_FOUND");return {id,archived};
}
export async function listProducts(db:D1Database,raw:unknown) {
 const q=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),state:z.enum(["active","archived"]).default("active"),query:z.string().max(120).default("")}).parse(raw);
 const pattern=`%${q.query.replace(/[\\%_]/g,"\\$&")}%`;
 const where=`p.archived_at IS ${q.state==="active"?"NULL":"NOT NULL"} AND (p.name LIKE ? ESCAPE '\\' OR p.slug LIKE ? ESCAPE '\\')`;
 const count=await db.prepare(`SELECT count(*) AS total FROM products p WHERE ${where}`).bind(pattern,pattern).first<{total:number}>();
 const {results}=await db.prepare(`SELECT p.*,(SELECT count(*) FROM codes c WHERE c.product_id=p.id) AS code_count FROM products p WHERE ${where} ORDER BY p.created_at DESC,p.id LIMIT 20 OFFSET ?`).bind(pattern,pattern,(q.page-1)*20).all<ProductRow>();
 return {products:results,total:count?.total??0,page:q.page,pageSize:20};
}
