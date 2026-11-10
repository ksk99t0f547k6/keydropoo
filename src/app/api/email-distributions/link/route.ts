import {runtime} from '@/lib/server/env';
import {createAuth} from '@/lib/server/auth';
import {HttpError,errorResponse} from '@/lib/server/http';
import {linkEmailDistributions} from '@/lib/server/email-distributions';
import {linkEmailedGuestClaims} from '@/lib/server/guest-claim-emails';
export async function POST(request:Request){
 try{const {env,settings}=await runtime();
  if(request.headers.get('origin')!==settings.APP_URL)throw new HttpError(403,'INVALID_ORIGIN');
  const session=await createAuth(env,settings).api.getSession({headers:request.headers});
  if(!session)throw new HttpError(401,'UNAUTHORIZED');
  const distributions=await linkEmailDistributions(env.DB,session.user.id,settings.BETTER_AUTH_SECRET);
  const claims=await linkEmailedGuestClaims(env.DB,session.user.id,settings.BETTER_AUTH_SECRET,100-distributions.linked);
  return Response.json({linked:distributions.linked+claims.linked},{headers:{'Cache-Control':'no-store'}});
 }catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
