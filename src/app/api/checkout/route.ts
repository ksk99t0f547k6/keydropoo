import {z} from "zod";
import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
import {orderIdentity} from "@/lib/server/order-identity";
import {claimRateLimit,clientNetwork,identityHash} from "@/lib/server/claim-identity";
import {reserveOrder} from "@/lib/server/orders";
import {createOrderCheckout,stripeClient,stripeGateway} from "@/lib/server/stripe";
import {readJson,errorResponse,HttpError} from "@/lib/server/http";
export async function POST(request:Request){
 let cookie:string|null=null;
 function finish(response:Response){response.headers.set("Cache-Control","no-store");if(cookie)response.headers.set("Set-Cookie",cookie);return response;}
 try{
  const {env,settings}=await runtime();if(request.headers.get("origin")!==settings.APP_URL)throw new HttpError(403,"INVALID_ORIGIN");
  if(!env.STRIPE_SECRET_KEY||!env.STRIPE_WEBHOOK_SECRET)throw new HttpError(503,"STRIPE_NOT_CONFIGURED");
  const session=await createAuth(env,settings).api.getSession({headers:request.headers});
  const actor=await orderIdentity(request.headers.get("cookie"),session?.user.id,settings.BETTER_AUTH_SECRET,settings.APP_URL);cookie=actor.setCookie;
  const local=process.env.NODE_ENV==='development'&&new URL(settings.APP_URL).hostname==='localhost';const rawIp=local?'127.0.0.1':request.headers.get('cf-connecting-ip');if(!rawIp)throw new HttpError(503,"CLAIM_IDENTITY_REQUIRED");const ip=clientNetwork(rawIp);
  if(!await claimRateLimit(env.DB,settings.BETTER_AUTH_SECRET,`checkout:${ip}`))throw new HttpError(429,"RATE_LIMITED");
  if(!session&&cookie)throw new HttpError(428,"BROWSER_IDENTITY_CREATED");
  const input=z.object({productId:z.uuid(),idempotencyKey:z.uuid()}).strict().parse(await readJson(request,2048));
  const product=await env.DB.prepare("SELECT checkout_batch_id FROM products WHERE id=? AND archived_at IS NULL").bind(input.productId).first<{checkout_batch_id:string|null}>();
  if(!product?.checkout_batch_id)throw new HttpError(404,"PRODUCT_NOT_FOR_SALE");
  const order=await reserveOrder(env.DB,{...input,batchId:product.checkout_batch_id,buyerKey:actor.buyerKey,ipKey:await identityHash(settings.BETTER_AUTH_SECRET,`order:ip:${ip}`),userId:session?.user.id??null,email:session?.user.email??null});
  return finish(Response.json(await createOrderCheckout(env.DB,stripeGateway(stripeClient(env.STRIPE_SECRET_KEY)),order,settings.APP_URL)));
 }catch(error){return finish(errorResponse(error));}
}
