import { z } from "zod";
import {
  PRODUCT_ICON_MAX_BYTES,
  PRODUCT_ICON_MAX_SIDE,
  PRODUCT_ICON_MIN_SIDE,
  PRODUCT_ICON_TYPES,
  sniffImage,
} from "@/lib/domain/product-icon";

export class ProductIconError extends Error {
  constructor(public code: "INVALID_IMAGE" | "IMAGE_TOO_LARGE" | "PRODUCT_NOT_FOUND") {
    super(code);
  }
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** 寫入或取代商品圖示；以檔頭判斷格式，宣告的類型必須一致。回傳新版本。 */
export async function setProductIcon(db: D1Database, productId: string, bytes: Uint8Array, declaredType: string | null) {
  z.uuid().parse(productId);
  if (bytes.length > PRODUCT_ICON_MAX_BYTES) throw new ProductIconError("IMAGE_TOO_LARGE");
  const image = sniffImage(bytes);
  const type = declaredType?.split(";")[0].trim().toLowerCase();
  if (!image || image.type !== type || !PRODUCT_ICON_TYPES.includes(image.type)) throw new ProductIconError("INVALID_IMAGE");
  const sides = [image.width, image.height];
  if (sides.some((side) => side < PRODUCT_ICON_MIN_SIDE || side > PRODUCT_ICON_MAX_SIDE)) throw new ProductIconError("INVALID_IMAGE");
  const exists = await db.prepare("SELECT id FROM products WHERE id=?").bind(productId).first();
  if (!exists) throw new ProductIconError("PRODUCT_NOT_FOUND");
  const version = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO product_icons (product_id,content_type,data,width,height,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET content_type=excluded.content_type,data=excluded.data,width=excluded.width,height=excluded.height,updated_at=excluded.updated_at",
      )
      .bind(productId, image.type, toBase64(bytes), image.width, image.height, now),
    db.prepare("UPDATE products SET icon_version=?,updated_at=? WHERE id=?").bind(version, now, productId),
  ]);
  return { version, type: image.type, width: image.width, height: image.height };
}

export async function removeProductIcon(db: D1Database, productId: string) {
  z.uuid().parse(productId);
  const now = Date.now();
  const [, product] = await db.batch([
    db.prepare("DELETE FROM product_icons WHERE product_id=?").bind(productId),
    db.prepare("UPDATE products SET icon_version=NULL,updated_at=? WHERE id=?").bind(now, productId),
  ]);
  if (!(product as D1Result).meta.changes) throw new ProductIconError("PRODUCT_NOT_FOUND");
}

export async function readProductIcon(db: D1Database, productId: string) {
  if (!z.uuid().safeParse(productId).success) return null;
  const row = await db
    .prepare("SELECT i.content_type,i.data,p.icon_version FROM product_icons i JOIN products p ON p.id=i.product_id WHERE i.product_id=?")
    .bind(productId)
    .first<{ content_type: string; data: string; icon_version: string | null }>();
  if (!row || !row.icon_version) return null;
  return { contentType: row.content_type, bytes: fromBase64(row.data), version: row.icon_version };
}
