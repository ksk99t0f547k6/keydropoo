import {z} from 'zod';
import {requireAdmin,readJson,errorResponse} from '@/lib/server/http';
import {listExternalReviews,resolveExternalReview} from '@/lib/server/external-reviews';
export async function GET(request:Request){
 try{const {env}=await requireAdmin(request);const {page}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
 return Response.json(await listExternalReviews(env.DB,page),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
 try{const {env,session}=await requireAdmin(request);
 return Response.json(await resolveExternalReview(env.DB,session.user.id,await readJson(request,10000)),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
