import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
import {orderIdentity} from "@/lib/server/order-identity";
import {linkGuestOrder} from "@/lib/server/orders";
import {HttpError,errorResponse} from "@/lib/server/http";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {env,settings}=await runtime();if(request.headers.get("origin")!==settings.APP_URL)throw new HttpError(403,"INVALID_ORIGIN");
  const session=await createAuth(env,settings).api.getSession({headers:request.headers});if(!session)throw new HttpError(401,"UNAUTHORIZED");
  const actor=await orderIdentity(request.headers.get('cookie'),session.user.id,settings.BETTER_AUTH_SECRET,settings.APP_URL);
  return Response.json(await linkGuestOrder(env.DB,(await params).id,actor.browserKey,session.user.id,actor.userKey!),{headers:{"Cache-Control":"no-store"}});
 }catch(error){return errorResponse(error);}
}
