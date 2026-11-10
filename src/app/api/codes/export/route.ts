import { requireAdmin,readJson,errorResponse,HttpError } from "@/lib/server/http";
import { exportCodes } from "@/lib/server/inventory";
export async function POST(request:Request) {
 try { const {env} = await requireAdmin(request); if(!env.CODE_ENCRYPTION_KEY) throw new HttpError(503,"ENCRYPTION_NOT_CONFIGURED");
  return Response.json({rows:await exportCodes(env.DB,env.CODE_ENCRYPTION_KEY,await readJson(request,8192))},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return errorResponse(e);}
}
