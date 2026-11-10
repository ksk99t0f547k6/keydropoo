import {runtime} from '@/lib/server/env';
import {createAuth} from '@/lib/server/auth';
import {browserIdentity} from '@/lib/server/claim-identity';
import {linkGuestClaim} from '@/lib/server/claims';
import {HttpError,errorResponse} from '@/lib/server/http';

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {env,settings}=await runtime();
  if(request.headers.get('origin')!==settings.APP_URL)throw new HttpError(403,'INVALID_ORIGIN');
  const session=await createAuth(env,settings).api.getSession({headers:request.headers});
  if(!session)throw new HttpError(401,'UNAUTHORIZED');
  const browser=await browserIdentity(request.headers.get('cookie'),settings.BETTER_AUTH_SECRET,settings.APP_URL.startsWith('https:'));
  if(browser.setCookie)throw new HttpError(403,'CLAIM_IDENTITY_REQUIRED');
  return Response.json(await linkGuestClaim(env.DB,(await params).id,browser.id,session.user.id,settings.BETTER_AUTH_SECRET),{headers:{'Cache-Control':'no-store'}});
 }catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
