import {z} from 'zod';
import {requireAdmin,readJson,errorResponse} from '@/lib/server/http';
import {listProductDevices,releaseProductDevice} from '@/lib/server/licenses';

function finish(response:Response){response.headers.set('Cache-Control','no-store');return response;}
export async function GET(request:Request){
 try{
  const {env}=await requireAdmin(request);
  const query=z.object({productId:z.uuid(),codeId:z.uuid().optional(),page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  return finish(Response.json(await listProductDevices(env.DB,query)));
 }catch(error){return finish(errorResponse(error));}
}
export async function DELETE(request:Request){
 try{
  const {env}=await requireAdmin(request);
  const input=z.object({productId:z.uuid(),activationId:z.uuid()}).strict().parse(await readJson(request,1024));
  return finish(Response.json(await releaseProductDevice(env.DB,input.productId,input.activationId)));
 }catch(error){return finish(errorResponse(error));}
}
