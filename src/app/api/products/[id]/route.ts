import { requireAdmin,readJson,errorResponse } from "@/lib/server/http";
import { updateProduct,archiveProduct } from "@/lib/server/inventory";
import { z } from "zod";
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}) {
 try{const{env}=await requireAdmin(request);const{id}=await params;return Response.json(await updateProduct(env.DB,id,await readJson(request,8192)));}catch(e){return errorResponse(e);}
}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
 try{const{env}=await requireAdmin(request);const{id}=await params;const input=z.object({archived:z.boolean()}).parse(await readJson(request,1024));return Response.json(await archiveProduct(env.DB,id,input.archived));}catch(e){return errorResponse(e);}
}
