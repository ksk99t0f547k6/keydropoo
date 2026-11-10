import {discountApiService} from "@/lib/server/stripe-discount-service";
import {externalRewardService} from "@/lib/server/external-reward-service";
import {claimServices} from "@/lib/server/claim-services";
import {runtime} from "@/lib/server/env";
import {authenticateApiToken} from "@/lib/server/api-tokens";
import {executeApiOperation} from "@/lib/server/api-operations";
import {readJson,errorResponse,HttpError} from "@/lib/server/http";
import {claimRateLimit} from "@/lib/server/claim-identity";
export async function POST(request:Request){
 try{
  const {env,settings}=await runtime();
  const principal=await authenticateApiToken(env.DB,request.headers.get("authorization"));
  if(!await claimRateLimit(env.DB,settings.BETTER_AUTH_SECRET,`api-token:${principal.id}`))throw new HttpError(429,"RATE_LIMITED");
  return Response.json(await executeApiOperation(env.DB,principal,await readJson(request,1048576),{claims:claimServices(env.DB,env,settings.BETTER_AUTH_SECRET),external:externalRewardService(env),discounts:discountApiService(env)}),{headers:{"Cache-Control":"no-store"}});
 }catch(error){const response=errorResponse(error);response.headers.set("Cache-Control","no-store");return response;}
}
