import {runtime} from "@/lib/server/env";
import {stripeWebhook} from "@/lib/server/stripe-http";
export async function POST(request:Request){const {env}=await runtime();return stripeWebhook(request,env);}
