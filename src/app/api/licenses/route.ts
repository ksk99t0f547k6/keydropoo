import {createAuth} from "@/lib/server/auth";
import {z} from "zod";
import {runtime} from "@/lib/server/env";
import {readJson,errorResponse,HttpError} from "@/lib/server/http";
import {claimRateLimit,clientNetwork} from "@/lib/server/claim-identity";
import {activateLicense,validateLicense,releaseLicense} from "@/lib/server/licenses";
export async function POST(request:Request){
 try{
  const {env,settings}=await runtime();const origin=request.headers.get("origin");if(origin&&origin!==settings.APP_URL)throw new HttpError(403,"INVALID_ORIGIN");
  const local=process.env.NODE_ENV==="development"&&["localhost","127.0.0.1"].includes(new URL(settings.APP_URL).hostname);
  const rawIp=local?"127.0.0.1":request.headers.get("cf-connecting-ip");const ip=rawIp?clientNetwork(rawIp):null;if(!ip)throw new HttpError(503,"LICENSE_IDENTITY_UNAVAILABLE");
  if(!await claimRateLimit(env.DB,settings.BETTER_AUTH_SECRET,`license:${ip}`))throw new HttpError(429,"RATE_LIMITED");
  const body=z.object({action:z.enum(["activate","validate","release"]),input:z.unknown()}).strict().parse(await readJson(request,4096));
  let result;
  if(body.action==="activate"){
   if(!env.CODE_ENCRYPTION_KEY)throw new HttpError(503,"ENCRYPTION_NOT_CONFIGURED");
   const session=await createAuth(env,settings).api.getSession({headers:request.headers});
   result=await activateLicense(env.DB,env.CODE_ENCRYPTION_KEY,settings.BETTER_AUTH_SECRET,body.input,Date.now(),session?.user.id);
  }else result=body.action==="validate"?await validateLicense(env.DB,settings.BETTER_AUTH_SECRET,body.input):await releaseLicense(env.DB,settings.BETTER_AUTH_SECRET,body.input);
  return Response.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(error){const response=errorResponse(error);response.headers.set("Cache-Control","no-store");return response;}
}
