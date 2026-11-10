import {requireAdmin,readJson,errorResponse,HttpError} from '@/lib/server/http';
import {queueEmailDistribution,listEmailDistributions,retryEmailDistribution} from '@/lib/server/email-distributions';
import {requestLocale} from '@/i18n/server-locale';
const headers={'Cache-Control':'no-store'};
export async function GET(request:Request){
 try{const {env,settings}=await requireAdmin(request);if(!env.CODE_ENCRYPTION_KEY)throw new HttpError(503,'ENCRYPTION_NOT_CONFIGURED');
 return Response.json({...await listEmailDistributions(env.DB,env.CODE_ENCRYPTION_KEY,Object.fromEntries(new URL(request.url).searchParams)),enabled:Boolean(env.EMAIL&&settings.EMAIL_FROM)},{headers});}
 catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
export async function POST(request:Request){
 try{const {env,settings,session}=await requireAdmin(request);if(!env.EMAIL||!settings.EMAIL_FROM)throw new HttpError(503,'EMAIL_NOT_CONFIGURED');if(!env.CODE_ENCRYPTION_KEY)throw new HttpError(503,'ENCRYPTION_NOT_CONFIGURED');
 return Response.json(await queueEmailDistribution(env.DB,session.user.id,await readJson(request,8192),{locale:await requestLocale(),encryptionSecret:env.CODE_ENCRYPTION_KEY,identitySecret:settings.BETTER_AUTH_SECRET}),{status:202,headers});}
 catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
export async function PATCH(request:Request){
 try{const {env,settings,session}=await requireAdmin(request);if(!env.EMAIL||!settings.EMAIL_FROM)throw new HttpError(503,'EMAIL_NOT_CONFIGURED');
 return Response.json(await retryEmailDistribution(env.DB,session.user.id,await readJson(request,8192)),{status:202,headers});}
 catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
