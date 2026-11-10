import {externalRewardService} from "@/lib/server/external-reward-service";
import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
import {readJson,errorResponse,HttpError} from "@/lib/server/http";
import {claimRateLimit} from "@/lib/server/claim-identity";
import {redeemCode} from "@/lib/server/redemptions";
export async function POST(request:Request){
 try{
  const {env,settings}=await runtime();if(request.headers.get("origin")!==settings.APP_URL)throw new HttpError(403,"INVALID_ORIGIN");
  const session=await createAuth(env,settings).api.getSession({headers:request.headers});if(!session)throw new HttpError(401,"UNAUTHORIZED");
  if(!await claimRateLimit(env.DB,settings.BETTER_AUTH_SECRET,`redeem-user:${session.user.id}`))throw new HttpError(429,"RATE_LIMITED");
  return Response.json(await redeemCode(env.DB,session.user.id,await readJson(request,4096),Date.now(),externalRewardService(env)),{headers:{"Cache-Control":"no-store"}});
 }catch(error){const result=errorResponse(error);result.headers.set("Cache-Control","no-store");return result;}
}
