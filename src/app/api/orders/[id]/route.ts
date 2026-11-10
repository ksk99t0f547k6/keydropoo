import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
import {orderIdentity} from "@/lib/server/order-identity";
import {getOrder,deliverOrder} from "@/lib/server/orders";
import {errorResponse,HttpError} from "@/lib/server/http";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {env,settings}=await runtime();const session=await createAuth(env,settings).api.getSession({headers:request.headers});
  const actor=await orderIdentity(request.headers.get("cookie"),session?.user.id,settings.BETTER_AUTH_SECRET,settings.APP_URL);
  const {id}=await params,order=await getOrder(env.DB,id);if(!order||!actor.allowedKeys.includes(order.buyer_key))throw new HttpError(404,"ORDER_NOT_FOUND");
  return Response.json(await deliverOrder(env.DB,env.CODE_ENCRYPTION_KEY??"",id,order.buyer_key),{headers:{"Cache-Control":"no-store"}});
 }catch(error){const response=errorResponse(error);response.headers.set("Cache-Control","no-store");return response;}
}
