import {z} from 'zod';
import {requireAdmin,readJson,errorResponse} from '@/lib/server/http';
import {listExternalRevocations,retryExternalRevocation} from '@/lib/server/external-revocations';
export async function GET(request:Request){
 try{const {env}=await requireAdmin(request);const {page}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json(await listExternalRevocations(env.DB,page),{headers:{'Cache-Control':'no-store'}});
 }catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
export async function POST(request:Request){
 try{const {env}=await requireAdmin(request);const {redemptionId}=z.object({redemptionId:z.uuid()}).strict().parse(await readJson(request,2048));
  return Response.json(await retryExternalRevocation(env.DB,redemptionId),{headers:{'Cache-Control':'no-store'}});
 }catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
