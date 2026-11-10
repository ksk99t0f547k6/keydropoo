import {z} from "zod";
import {requireAdmin,readJson,errorResponse,HttpError} from "@/lib/server/http";
import {getOrder,fulfillWaitingOrder} from "@/lib/server/orders";
import {reconcileCheckout,stripeClient,stripeGateway} from "@/lib/server/stripe";
import {refundReviewInput,reviewOrderRefund} from '@/lib/server/order-refund-reviews';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {env,session}=await requireAdmin(request);const id=z.uuid().parse((await params).id);
  const input=z.discriminatedUnion('action',[
   z.object({action:z.enum(['synchronize','fulfill'])}).strict(),
   refundReviewInput.omit({orderId:true}).extend({action:z.literal('review-refund')}).strict(),
  ]).parse(await readJson(request,16384));
  if(input.action==='review-refund'){
   const {action,...review}=input;void action;
   return Response.json(await reviewOrderRefund(env.DB,session.user.id,{...review,orderId:id}),{headers:{'Cache-Control':'no-store'}});
  }
  const {action}=input;
  const order=await getOrder(env.DB,id);if(!order)throw new HttpError(404,"ORDER_NOT_FOUND");
  if(action==='synchronize'){
   if(!env.STRIPE_SECRET_KEY||!order.checkout_session_id)throw new HttpError(409,"ORDER_CANNOT_SYNC");
   await reconcileCheckout(env.DB,stripeGateway(stripeClient(env.STRIPE_SECRET_KEY)),order.checkout_session_id);
  }else{
   if(!['manual','backorder'].includes(order.status))throw new HttpError(409,"ORDER_CANNOT_FULFILL");
   const result=await fulfillWaitingOrder(env.DB,id,true);if(result?.status!=='fulfilled')throw new HttpError(409,"ORDER_STOCK_UNAVAILABLE");
  }
  return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 }catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
