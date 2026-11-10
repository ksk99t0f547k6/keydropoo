import {z} from "zod";
import {requireAdmin,readJson,errorResponse,HttpError} from "@/lib/server/http";
import {getCampaign,updateCampaign,setCampaignStatus} from "@/lib/server/campaigns";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){
 try{
  const {env}=await requireAdmin(request);const {id}=await params;
  const campaign=await getCampaign(env.DB,id);if(!campaign)throw new HttpError(404,"CAMPAIGN_NOT_FOUND");
  return Response.json(campaign,{headers:{"Cache-Control":"no-store"}});
 }catch(error){return errorResponse(error);}
}
export async function PUT(request:Request,{params}:Context){
 try{
  const {env}=await requireAdmin(request);const {id}=await params;
  const {version,campaign}=z.object({version:z.number().int().min(1),campaign:z.unknown()}).strict().parse(await readJson(request,65536));
  return Response.json(await updateCampaign(env.DB,id,version,campaign));
 }catch(error){return errorResponse(error);}
}
export async function PATCH(request:Request,{params}:Context){
 try{
  const {env}=await requireAdmin(request);const {id}=await params;
  const {version,status}=z.object({version:z.number().int().min(1),status:z.enum(["draft","active","paused","archived"])}).strict().parse(await readJson(request,1024));
  return Response.json(await setCampaignStatus(env.DB,id,version,status));
 }catch(error){return errorResponse(error);}
}
