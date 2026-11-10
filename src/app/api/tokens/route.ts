import {z} from "zod";
import {requireAdmin,readJson,errorResponse} from "@/lib/server/http";
import {createApiToken,revokeApiToken,listApiTokens} from "@/lib/server/api-tokens";
export async function GET(request:Request){try{const {env}=await requireAdmin(request);return Response.json(await listApiTokens(env.DB),{headers:{"Cache-Control":"no-store"}});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{const {env}=await requireAdmin(request);return Response.json(await createApiToken(env.DB,await readJson(request,32768)),{status:201,headers:{"Cache-Control":"no-store"}});}catch(error){return errorResponse(error);}}
export async function DELETE(request:Request){try{const {env}=await requireAdmin(request);const input=z.object({id:z.uuid()}).strict().parse(await readJson(request,1024));await revokeApiToken(env.DB,input.id);return Response.json({ok:true});}catch(error){return errorResponse(error);}}
