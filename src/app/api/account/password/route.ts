import {runtime} from '@/lib/server/env';
import {errorResponse} from '@/lib/server/http';
import {setAccountPassword} from '@/lib/server/password-settings';

export async function POST(request:Request){
 try{
  const {env,settings}=await runtime();
  return Response.json(await setAccountPassword(request,env,settings),{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;
 }
}
