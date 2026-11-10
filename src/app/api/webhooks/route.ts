import {z} from "zod";
import {requireAdmin,readJson,errorResponse} from "@/lib/server/http";
import {createWebhookEndpoint,listWebhookEndpoints,listWebhookDeliveries,setWebhookEnabled,retryWebhookDelivery} from "@/lib/server/webhook-management";
import {webhookSecrets} from "@/lib/server/webhook-http";
export async function GET(request:Request){
 try{
  const {env}=await requireAdmin(request);const query=Object.fromEntries(new URL(request.url).searchParams);
  return Response.json(query.endpointId?await listWebhookDeliveries(env.DB,query):{endpoints:await listWebhookEndpoints(env.DB)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
 try{const {env}=await requireAdmin(request);return Response.json(await createWebhookEndpoint(env.DB,await readJson(request,65536)),{status:201,headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}
}
export async function PATCH(request:Request){
 try{
  const {env}=await requireAdmin(request);
  const input=z.discriminatedUnion('action',[
   z.object({action:z.literal('enabled'),endpointId:z.uuid(),enabled:z.boolean()}).strict(),
   z.object({action:z.literal('retry'),endpointId:z.uuid(),deliveryId:z.string()}).strict(),
  ]).parse(await readJson(request,2048));
  const result=input.action==='enabled'?await setWebhookEnabled(env.DB,input.endpointId,input.enabled,input.enabled?webhookSecrets(env.WEBHOOK_SECRETS):{}):await retryWebhookDelivery(env.DB,input.endpointId,input.deliveryId);
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
