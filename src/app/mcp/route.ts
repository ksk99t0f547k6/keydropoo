import {discountApiService} from "@/lib/server/stripe-discount-service";
import {externalRewardService} from "@/lib/server/external-reward-service";
import {claimServices} from "@/lib/server/claim-services";
import {runtime} from "@/lib/server/env";
import {handleMcpRequest} from "@/lib/server/mcp";
async function handle(request:Request){
 const {env,settings}=await runtime();
 return handleMcpRequest(request,{db:env.DB,appUrl:settings.APP_URL,identitySecret:settings.BETTER_AUTH_SECRET,services:{claims:claimServices(env.DB,env,settings.BETTER_AUTH_SECRET),external:externalRewardService(env),discounts:discountApiService(env)}});
}
export const POST=handle;
export const GET=handle;
export const DELETE=handle;
