import { requireAdmin, readJson, errorResponse, HttpError } from "@/lib/server/http";
import { listBatches } from "@/lib/server/inventory";
import { createFormBatch } from "@/lib/server/batch-creation";
export async function POST(request: Request) {
 try {
  const { env } = await requireAdmin(request);
  if (!env.CODE_ENCRYPTION_KEY) throw new HttpError(503,"ENCRYPTION_NOT_CONFIGURED");
  return Response.json(await createFormBatch(env.DB,env.CODE_ENCRYPTION_KEY,await readJson(request)),{ status: 201,headers:{"Cache-Control":"no-store"} });
 } catch (e) { return errorResponse(e); }
}

export async function GET(request:Request) {
 try { const {env} = await requireAdmin(request); return Response.json({batches:await listBatches(env.DB,new URL(request.url).searchParams.get("productId") ?? "")}); }
 catch(e){return errorResponse(e);}
}
