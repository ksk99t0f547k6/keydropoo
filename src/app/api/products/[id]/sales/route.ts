import {z} from "zod";
import {requireAdmin,readJson,errorResponse} from "@/lib/server/http";
import {setSalesBatch} from "@/lib/server/sales";
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {env}=await requireAdmin(request);const id=z.uuid().parse((await params).id);
  const {batchId,allowPromotionCodes,stripeProductId}=z.object({batchId:z.uuid().nullable(),allowPromotionCodes:z.boolean().optional(),stripeProductId:z.string().regex(/^prod_[A-Za-z0-9]+$/).max(255).nullable().optional()}).strict().parse(await readJson(request,1024));
  return Response.json(await setSalesBatch(env.DB,id,batchId,allowPromotionCodes,stripeProductId));
 }catch(error){return errorResponse(error);}
}
