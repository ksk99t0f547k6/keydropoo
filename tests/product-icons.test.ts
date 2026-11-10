import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "./d1";
import { createBatch, createProduct } from "../src/lib/server/inventory";
import { sniffImage, productIconUrl, PRODUCT_ICON_MAX_BYTES } from "../src/lib/domain/product-icon";
import { setProductIcon, ProductIconError } from "../src/lib/server/product-icons";
import { handoutSources } from "../src/lib/server/handouts";

const fixture = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  admin: false,
  env: { DB: null as unknown as D1Database },
  settings: { APP_URL: "https://keydrop.test" },
}));
vi.mock("../src/lib/server/env", () => ({ runtime: async () => ({ env: fixture.env, settings: fixture.settings }) }));
vi.mock("../src/lib/server/auth", () => ({ createAuth: () => ({ api: { getSession: async () => fixture.session } }), isAdmin: async () => fixture.admin }));
import { DELETE, GET, PUT } from "../src/app/api/products/[id]/icon/route";

// 只需要正確的檔頭；伺服器不解碼像素。
function png(width: number, height: number, extra = 64) {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
function riff(chunk: string, body: number[]) {
  const bytes = new Uint8Array(40);
  bytes.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  bytes.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  bytes.set([...chunk].map((c) => c.charCodeAt(0)), 12);
  bytes.set(body, 20);
  return bytes;
}
function jpeg(width: number, height: number) {
  // SOI、APP0（長度 16）、SOF0
  const bytes = new Uint8Array(2 + 18 + 19);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0);
  const sof = 20;
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], sof);
  const view = new DataView(bytes.buffer);
  view.setUint16(sof + 5, height);
  view.setUint16(sof + 7, width);
  return bytes;
}

describe("sniffImage", () => {
  it("從檔頭讀出 PNG、WebP（三種）與 JPEG 的尺寸", () => {
    expect(sniffImage(png(256, 128))).toEqual({ type: "image/png", width: 256, height: 128 });
    // VP8（有損）：寬高在幀標頭後，各 14 位元
    expect(sniffImage(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x01, 0x00, 0x01]))).toEqual({ type: "image/webp", width: 256, height: 256 });
    // VP8L（無損）：簽章 0x2f 之後，寬高減 1 各佔 14 位元
    const bits = (255 & 0x3fff) | ((127 & 0x3fff) << 14);
    expect(sniffImage(riff("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff]))).toEqual({ type: "image/webp", width: 256, height: 128 });
    // VP8X：旗標與保留位元組之後，寬高減 1 各佔 24 位元
    expect(sniffImage(riff("VP8X", [0, 0, 0, 0, 0xff, 0x00, 0x00, 0xff, 0x00, 0x00]))).toEqual({ type: "image/webp", width: 256, height: 256 });
    expect(sniffImage(jpeg(300, 200))).toEqual({ type: "image/jpeg", width: 300, height: 200 });
  });

  it("不認得的格式（SVG、GIF、HTML、空檔）一律拒絕", () => {
    const text = (value: string) => new TextEncoder().encode(value);
    expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(text("GIF89a......"))).toBeNull();
    expect(sniffImage(text("<html><body>hi</body></html>"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("商品圖示", () => {
  let database: ReturnType<typeof testDatabase>;
  beforeEach(() => {
    database = testDatabase();
    fixture.env.DB = database.db;
    fixture.session = null;
    fixture.admin = false;
    database.sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,0,0)').run("admin", "Admin", "admin@example.test", 1);
    database.sqlite.prepare("INSERT INTO installation(id,admin_user_id,created_at) VALUES(1,'admin',0)").run();
  });
  afterEach(() => database.sqlite.close());
  const put = (id: string, body: Uint8Array<ArrayBuffer>, type: string, origin = "https://keydrop.test") =>
    PUT(new Request(`https://keydrop.test/api/products/${id}/icon`, { method: "PUT", headers: { origin, "Content-Type": type }, body }), { params: Promise.resolve({ id }) });
  const get = (id: string, query = "", headers: Record<string, string> = {}) =>
    GET(new Request(`https://keydrop.test/api/products/${id}/icon${query}`, { headers }), { params: Promise.resolve({ id }) });

  it("寫入要求類型與檔頭一致、尺寸在範圍內，取代時版本會變", async () => {
    const product = await createProduct(database.db, { name: "App", slug: "app" });
    await expect(setProductIcon(database.db, product.id, png(256, 256), "image/webp")).rejects.toThrow(ProductIconError);
    await expect(setProductIcon(database.db, product.id, png(16, 16), "image/png")).rejects.toThrow("INVALID_IMAGE");
    await expect(setProductIcon(database.db, product.id, png(2048, 2048), "image/png")).rejects.toThrow("INVALID_IMAGE");
    await expect(setProductIcon(database.db, product.id, png(256, 256, PRODUCT_ICON_MAX_BYTES), "image/png")).rejects.toThrow("IMAGE_TOO_LARGE");
    await expect(setProductIcon(database.db, crypto.randomUUID(), png(256, 256), "image/png")).rejects.toThrow("PRODUCT_NOT_FOUND");
    const first = await setProductIcon(database.db, product.id, png(256, 256), "image/png");
    const second = await setProductIcon(database.db, product.id, jpeg(256, 256), "image/jpeg");
    expect(second.version).not.toBe(first.version);
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM product_icons").get()?.n).toBe(1);
    expect(database.sqlite.prepare("SELECT icon_version FROM products").get()?.icon_version).toBe(second.version);
    // 手動發放的商品選項帶出含版本的圖示網址
    await createBatch(database.db, "ab".repeat(32), { productId: product.id, name: "Promo", kind: "external", source: "manual", codes: ["PROMO-1"] });
    const [source] = await handoutSources(database.db);
    expect(source.icon).toBe(productIconUrl(product.id, second.version));
    expect(source.icon).toBe(`/api/products/${product.id}/icon?v=${second.version}`);
  });

  it("只有管理員能上傳與刪除；公開讀取帶安全標頭，帶版本時長期快取", async () => {
    const product = await createProduct(database.db, { name: "App", slug: "app" });
    expect((await put(product.id, png(256, 256), "image/png")).status).toBe(401);
    fixture.session = { user: { id: "admin" } };
    expect((await put(product.id, png(256, 256), "image/png")).status).toBe(403);
    fixture.admin = true;
    expect((await put(product.id, png(256, 256), "image/png", "https://evil.test")).status).toBe(403);
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect((await put(product.id, svg, "image/svg+xml")).status).toBe(400);
    expect((await put(product.id, png(256, 256, PRODUCT_ICON_MAX_BYTES), "image/png")).status).toBe(413);
    expect((await get(product.id)).status).toBe(404);

    const saved = await put(product.id, png(256, 256), "image/png");
    expect(saved.status).toBe(200);
    const { version } = (await saved.json()) as { version: string };
    const fresh = await get(product.id, `?v=${version}`);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("Content-Type")).toBe("image/png");
    expect(fresh.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(fresh.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(fresh.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await fresh.arrayBuffer())).toEqual(png(256, 256));
    expect((await get(product.id, "?v=old")).headers.get("Cache-Control")).not.toContain("immutable");
    expect((await get(product.id, "", { "if-none-match": `"${version}"` })).status).toBe(304);
    expect((await get("not-a-uuid")).status).toBe(404);

    const removed = await DELETE(new Request(`https://keydrop.test/api/products/${product.id}/icon`, { method: "DELETE", headers: { origin: "https://keydrop.test" } }), { params: Promise.resolve({ id: product.id }) });
    expect(removed.status).toBe(204);
    expect((await get(product.id, `?v=${version}`)).status).toBe(404);
    expect(database.sqlite.prepare("SELECT icon_version FROM products").get()?.icon_version).toBeNull();
  });
});
