import {z} from "zod";
import {requireAdmin,readJson,errorResponse} from "@/lib/server/http";
import {saveRewardRule,getRewardRule} from "@/lib/server/redemptions";
export async function GET(request:Request){
 try{const {env}=await requireAdmin(request);const q=z.object({batchId:z.uuid(),campaignId:z.uuid().optional()}).parse(Object.fromEntries(new URL(request.url).searchParams));return Response.json(await getRewardRule(env.DB,q.batchId,q.campaignId??null),{headers:{"Cache-Control":"no-store"}});}catch(error){return errorResponse(error);}
}
export async function PUT(request:Request){
 try{const {env}=await requireAdmin(request);return Response.json(await saveRewardRule(env.DB,await readJson(request,4096)));}catch(error){return errorResponse(error);}
}
