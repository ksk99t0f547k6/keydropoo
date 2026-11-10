import {requireAdmin,readJson,errorResponse} from '@/lib/server/http';
import {assignCode,listAssignments} from '@/lib/server/assignments';
export async function POST(request:Request){
 try{const {env,session}=await requireAdmin(request);return Response.json(await assignCode(env.DB,session.user.id,await readJson(request,8192)),{headers:{'Cache-Control':'no-store'}});}
 catch(error){return errorResponse(error);}
}
export async function GET(request:Request){
 try{const {env}=await requireAdmin(request);return Response.json(await listAssignments(env.DB,Object.fromEntries(new URL(request.url).searchParams)),{headers:{'Cache-Control':'no-store'}});}
 catch(error){return errorResponse(error);}
}
