import { requireAdmin,readJson,errorResponse,HttpError } from "@/lib/server/http";
import { restockBatch } from "@/lib/server/restock";

export async function POST(request:Request){
 try{
  const {env}=await requireAdmin(request);
  if(!env.CODE_ENCRYPTION_KEY)throw new HttpError(503,"ENCRYPTION_NOT_CONFIGURED");
  const result=await restockBatch(env.DB,env.CODE_ENCRYPTION_KEY,await readJson(request));
  return Response.json(result,{headers:{"cache-control":"no-store"}});
 }catch(error){return errorResponse(error);}
}
