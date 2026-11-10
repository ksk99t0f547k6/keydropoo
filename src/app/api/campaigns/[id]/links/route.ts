import {z} from "zod";
import {requireAdmin,readJson,errorResponse,HttpError} from "@/lib/server/http";
import {getCampaign} from "@/lib/server/campaigns";
import {createCampaignLink,revokeCampaignLink} from "@/lib/server/claims";
type Context={params:Promise<{id:string}>};
export async function POST(request:Request,{params}:Context){
 try{const {env,settings}=await requireAdmin(request);const {id}=await params;const campaign=await getCampaign(env.DB,id);if(!campaign)throw new HttpError(404,"CAMPAIGN_NOT_FOUND");const link=await createCampaignLink(env.DB,id,await readJson(request,1024));return Response.json({...link,url:`${settings.APP_URL}/claim/${campaign.slug}#token=${link.token}`},{status:201,headers:{"Cache-Control":"no-store"}});}catch(error){return errorResponse(error);}
}
export async function DELETE(request:Request,{params}:Context){
 try{const {env}=await requireAdmin(request);const {id}=await params;const input=z.object({id:z.uuid()}).strict().parse(await readJson(request,1024));await revokeCampaignLink(env.DB,id,input.id);return Response.json({ok:true});}catch(error){return errorResponse(error);}
}
