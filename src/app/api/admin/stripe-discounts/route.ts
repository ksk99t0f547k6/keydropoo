import {requireAdmin,readJson,errorResponse,HttpError} from '@/lib/server/http';
import {connectStripeDiscounts,discountAction,executeDiscountAction} from '@/lib/server/stripe-discount-service';
export async function GET(request:Request){
 try{const {env}=await requireAdmin(request);const {scope}=await connectStripeDiscounts(env.STRIPE_SECRET_KEY);
 return Response.json(scope,{headers:{'Cache-Control':'no-store'}});
 }catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
export async function POST(request:Request){
 try{const {env}=await requireAdmin(request);if(!env.CODE_ENCRYPTION_KEY)throw new HttpError(503,"ENCRYPTION_NOT_CONFIGURED");const input=discountAction.parse(await readJson(request,32768));
 const connection=await connectStripeDiscounts(env.STRIPE_SECRET_KEY);
 return Response.json(await executeDiscountAction(env.DB,env.CODE_ENCRYPTION_KEY,connection,input),{headers:{'Cache-Control':'no-store'}});
 }catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
