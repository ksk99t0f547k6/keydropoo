import {HttpError,errorResponse} from "./http";
import {stripeClient,stripeGateway,verifyStripeEvent,processStripeEvent,type StripeGateway} from "./stripe";
export async function stripeWebhook(request:Request,env:{DB:D1Database;STRIPE_SECRET_KEY?:string;STRIPE_WEBHOOK_SECRET?:string},gateway?:StripeGateway){
 try{
  if(!env.STRIPE_SECRET_KEY||!env.STRIPE_WEBHOOK_SECRET)throw new HttpError(503,"STRIPE_NOT_CONFIGURED");
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,"INVALID_INPUT");
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();throw new HttpError(413,"REQUEST_TOO_LARGE");}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const payload=new TextDecoder().decode(bytes),client=stripeClient(env.STRIPE_SECRET_KEY);
  const event=await verifyStripeEvent(client,payload,request.headers.get("stripe-signature"),env.STRIPE_WEBHOOK_SECRET);
  const result=await processStripeEvent(env.DB,gateway??stripeGateway(client),event);
  return Response.json({received:true,...result},{headers:{"Cache-Control":"no-store"}});
 }catch(error){const message=error instanceof Error?error.message:"";const response=message==='STRIPE_SIGNATURE_INVALID'?Response.json({error:message},{status:400}):errorResponse(error);response.headers.set("Cache-Control","no-store");return response;}
}
