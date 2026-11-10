import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
import {orderIdentity} from "@/lib/server/order-identity";
import {claimRateLimit} from "@/lib/server/claim-identity";
import {getOrder} from "@/lib/server/orders";
import {createOrderCheckout,reconcileCheckout,stripeGateway,stripeClient} from "@/lib/server/stripe";
import {HttpError,errorResponse} from "@/lib/server/http";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {env,settings}=await runtime();if(request.headers.get("origin")!==settings.APP_URL)throw new HttpError(403,"INVALID_ORIGIN");
  if(!env.STRIPE_SECRET_KEY||!env.STRIPE_WEBHOOK_SECRET)throw new HttpError(503,"STRIPE_NOT_CONFIGURED");
  const session=await createAuth(env,settings).api.getSession({headers:request.headers});const actor=await orderIdentity(request.headers.get("cookie"),session?.user.id,settings.BETTER_AUTH_SECRET,settings.APP_URL);
  const {id}=await params,order=await getOrder(env.DB,id);if(!order||!actor.allowedKeys.includes(order.buyer_key))throw new HttpError(404,"ORDER_NOT_FOUND");
  if(!await claimRateLimit(env.DB,settings.BETTER_AUTH_SECRET,`resume:${actor.buyerKey}`))throw new HttpError(429,"RATE_LIMITED");
  const gateway=stripeGateway(stripeClient(env.STRIPE_SECRET_KEY));const result=await createOrderCheckout(env.DB,gateway,order,settings.APP_URL);
  if(!result.url&&order.checkout_session_id)await reconcileCheckout(env.DB,gateway,order.checkout_session_id);
  return Response.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(error){return errorResponse(error);}
}
