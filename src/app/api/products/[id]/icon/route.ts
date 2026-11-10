import { HttpError, errorResponse, requireAdmin } from "@/lib/server/http";
import { runtime } from "@/lib/server/env";
import { ProductIconError, readProductIcon, removeProductIcon, setProductIcon } from "@/lib/server/product-icons";
import { PRODUCT_ICON_MAX_BYTES } from "@/lib/domain/product-icon";

// 圖示回應一律當成純圖片：不讓瀏覽器猜類型，也不執行任何內容。
const imageHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Content-Disposition": "inline",
};

function iconError(error: unknown) {
  if (error instanceof ProductIconError) {
    const status = error.code === "PRODUCT_NOT_FOUND" ? 404 : error.code === "IMAGE_TOO_LARGE" ? 413 : 400;
    return Response.json({ error: error.code }, { status });
  }
  return errorResponse(error);
}

async function readBytes(request: Request) {
  if (!request.body) throw new HttpError(400, "INVALID_INPUT");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > PRODUCT_ICON_MAX_BYTES) throw new ProductIconError("IMAGE_TOO_LARGE");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > PRODUCT_ICON_MAX_BYTES) {
      await reader.cancel();
      throw new ProductIconError("IMAGE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

// 公開讀取：分享卡片、公開購買／兌換頁都會用到，網址帶版本時長期快取。
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = await runtime();
  const { id } = await params;
  const icon = await readProductIcon(env.DB, id);
  if (!icon) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const requested = new URL(request.url).searchParams.get("v");
  const etag = `"${icon.version}"`;
  const cache = requested === icon.version ? "public, max-age=31536000, immutable" : "public, max-age=60, must-revalidate";
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cache } });
  return new Response(icon.bytes, {
    headers: { ...imageHeaders, "Content-Type": icon.contentType, "Content-Length": String(icon.bytes.length), ETag: etag, "Cache-Control": cache },
  });
}

// 管理員上傳：本文是圖片本身，Content-Type 為 image/png、image/webp 或 image/jpeg。
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { env } = await requireAdmin(request);
    const { id } = await params;
    const result = await setProductIcon(env.DB, id, await readBytes(request), request.headers.get("content-type"));
    return Response.json(result);
  } catch (error) {
    return iconError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { env } = await requireAdmin(request);
    const { id } = await params;
    await removeProductIcon(env.DB, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return iconError(error);
  }
}
