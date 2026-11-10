import { requireAdmin,readJson,errorResponse } from "@/lib/server/http";
import { listCodes } from "@/lib/server/inventory";
export async function POST(request:Request) {
 try { const {env}=await requireAdmin(request);return Response.json(await listCodes(env.DB,await readJson(request,4096)),{headers:{"Cache-Control":"no-store"}}); }
 catch(e){return errorResponse(e);}
}
