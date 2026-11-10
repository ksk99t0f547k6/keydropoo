import {requireAdmin,readJson,errorResponse} from "@/lib/server/http";
import {createCampaign,listCampaigns} from "@/lib/server/campaigns";
export async function GET(request:Request){
 try{const {env}=await requireAdmin(request);return Response.json(await listCampaigns(env.DB,Object.fromEntries(new URL(request.url).searchParams)),{headers:{"Cache-Control":"no-store"}});}catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
 try{const {env}=await requireAdmin(request);return Response.json(await createCampaign(env.DB,await readJson(request,65536)),{status:201});}catch(error){return errorResponse(error);}
}
