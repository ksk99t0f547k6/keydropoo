import {requireAdmin,readJson,errorResponse,HttpError} from "@/lib/server/http";
import {getCampaign} from "@/lib/server/campaigns";
import {saveCampaignCredential,revokeCampaignCredential} from "@/lib/server/campaign-credentials";
type Context={params:Promise<{id:string}>};
export async function POST(request:Request,{params}:Context){
 try{const {env}=await requireAdmin(request);const {id}=await params;if(!await getCampaign(env.DB,id))throw new HttpError(404,"CAMPAIGN_NOT_FOUND");return Response.json(await saveCampaignCredential(env.DB,id,await readJson(request,2048)));}catch(error){return errorResponse(error);}
}
export async function DELETE(request:Request,{params}:Context){
 try{const {env}=await requireAdmin(request);const {id}=await params;if(!await getCampaign(env.DB,id))throw new HttpError(404,"CAMPAIGN_NOT_FOUND");await revokeCampaignCredential(env.DB,id,await readJson(request,1024));return Response.json({ok:true});}catch(error){return errorResponse(error);}
}
