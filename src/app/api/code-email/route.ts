import {runtime} from '@/lib/server/env';
import {createAuth} from '@/lib/server/auth';
import {HttpError,readJson,errorResponse} from '@/lib/server/http';
import {queueCodeEmail} from '@/lib/server/code-email';
import {claimRateLimit} from '@/lib/server/claim-identity';
export async function POST(request:Request){
 try{
  const {env,settings}=await runtime();
  if(request.headers.get('origin')!==settings.APP_URL)throw new HttpError(403,'INVALID_ORIGIN');
  const session=await createAuth(env,settings).api.getSession({headers:request.headers});if(!session)throw new HttpError(401,'UNAUTHORIZED');
  if(!env.EMAIL||!settings.EMAIL_FROM||!env.CODE_ENCRYPTION_KEY)throw new HttpError(503,'EMAIL_NOT_CONFIGURED');
  if(!await claimRateLimit(env.DB,settings.BETTER_AUTH_SECRET,`code-email:${session.user.id}`,Date.now(),5))throw new HttpError(429,'RATE_LIMITED');
  return Response.json(await queueCodeEmail(env.DB,session.user.id,await readJson(request,2048)),{status:202,headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}

export async function GET(request:Request){
 try{
  const {env,settings}=await runtime();const session=await createAuth(env,settings).api.getSession({headers:request.headers});
  if(!session)throw new HttpError(401,'UNAUTHORIZED');
  const {getCodeEmailStatus}=await import('@/lib/server/code-email');
  return Response.json(await getCodeEmailStatus(env.DB,session.user.id,new URL(request.url).searchParams.get('id')??''),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
