import { requireAdmin, readJson, errorResponse } from "@/lib/server/http";
import { createProduct,listProducts } from "@/lib/server/inventory";
export async function GET(request: Request) {
 try {
  const { env } = await requireAdmin(request);
  return Response.json(await listProducts(env.DB,Object.fromEntries(new URL(request.url).searchParams)));
 } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
 try { const { env } = await requireAdmin(request); return Response.json(await createProduct(env.DB,await readJson(request,8192)),{ status: 201 }); }
 catch (e) { return errorResponse(e); }
}
