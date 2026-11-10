import {requireAdmin,errorResponse} from '@/lib/server/http';
import {readProductEntitlements} from '@/lib/server/admin-entitlements';

export async function GET(request:Request){
 let response:Response;
 try{
  const {env}=await requireAdmin(request);
  const {productId,...query}=Object.fromEntries(new URL(request.url).searchParams);
  response=Response.json(await readProductEntitlements(env.DB,productId,{view:'credits',...query}));
 }catch(error){response=errorResponse(error);}
 response.headers.set('Cache-Control','no-store');return response;
}
