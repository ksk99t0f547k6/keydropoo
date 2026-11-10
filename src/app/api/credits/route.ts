import {z} from "zod";
import {requireAdmin,readJson,errorResponse} from "@/lib/server/http";
import {creditHistory,creditGrantStatus,manageCredits} from "@/lib/server/credits";
export async function GET(request:Request){
 try{
  const {env}=await requireAdmin(request);const q=z.object({walletId:z.uuid(),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json({...await creditHistory(env.DB,q.walletId,q.page),grants:await creditGrantStatus(env.DB,q.walletId)},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
 try{const {env}=await requireAdmin(request);return Response.json(await manageCredits(env.DB,await readJson(request,4096)),{headers:{"Cache-Control":"no-store"}});}catch(error){return errorResponse(error);}
}
