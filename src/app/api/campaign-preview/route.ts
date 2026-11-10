import {z} from "zod";
import {runtime} from "@/lib/server/env";
import {readJson,errorResponse,HttpError} from "@/lib/server/http";
import {publicCampaign} from "@/lib/server/public-campaigns";
export async function POST(request:Request){
 try{
  const {env,settings}=await runtime();if(request.headers.get("origin")!==settings.APP_URL)throw new HttpError(403,"INVALID_ORIGIN");
  const input=z.object({slug:z.string().max(80),token:z.string().max(64).optional()}).strict().parse(await readJson(request,1024));
  const campaign=await publicCampaign(env.DB,input.slug,input.token);if(!campaign)throw new HttpError(404,"CAMPAIGN_NOT_FOUND");
  return Response.json(campaign,{headers:{"Cache-Control":"no-store"}});
 }catch(error){const response=errorResponse(error);response.headers.set("Cache-Control","no-store");return response;}
}
