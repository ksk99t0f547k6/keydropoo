import { requireAdmin,readJson,errorResponse,HttpError } from "@/lib/server/http";
import { listCodes,changeCodeStatus } from "@/lib/server/inventory";
export async function GET(request:Request) {
 try { const {env} = await requireAdmin(request); const params=new URL(request.url).searchParams;if(params.has("code"))throw new HttpError(400,"USE_POST_SEARCH"); return Response.json(await listCodes(env.DB,Object.fromEntries(params))); }
 catch(e){return errorResponse(e);}
}
export async function PATCH(request:Request) {
 try { const {env} = await requireAdmin(request); return Response.json(await changeCodeStatus(env.DB,await readJson(request,65536))); }
 catch(e){return errorResponse(e);}
}
