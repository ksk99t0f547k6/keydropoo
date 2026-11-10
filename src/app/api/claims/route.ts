import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
import {readJson,errorResponse,HttpError} from "@/lib/server/http";
import {claimCode} from "@/lib/server/claims";
import {browserIdentity,claimRateLimit,clientNetwork} from "@/lib/server/claim-identity";
import {claimServices} from "@/lib/server/claim-services";
export async function POST(request:Request){
 let cookie:string|null=null;
 function finish(response:Response){response.headers.set("Cache-Control","no-store");if(cookie)response.headers.set("Set-Cookie",cookie);return response;}
 try{
  const {env,settings}=await runtime();
  if(request.headers.get("origin")!==settings.APP_URL)throw new HttpError(403,"INVALID_ORIGIN");
  const local=process.env.NODE_ENV==="development"&&["localhost","127.0.0.1"].includes(new URL(settings.APP_URL).hostname);
  const rawIp=local?"127.0.0.1":request.headers.get("cf-connecting-ip");
  const ip=rawIp?clientNetwork(rawIp):null;
  if(!ip)throw new HttpError(503,"CLAIM_IDENTITY_REQUIRED");
  if(!await claimRateLimit(env.DB,settings.BETTER_AUTH_SECRET,ip))throw new HttpError(429,"RATE_LIMITED");
  const body=await readJson(request,32768);
  const session=await createAuth(env,settings).api.getSession({headers:request.headers});
  const browser=await browserIdentity(request.headers.get("cookie"),settings.BETTER_AUTH_SECRET,settings.APP_URL.startsWith("https:"));cookie=browser.setCookie;
  // 匿名首次請求先寫入可信 cookie，第二次才分配，避免結果遺失時換了持有人。
  if(!session&&cookie)throw new HttpError(428,"BROWSER_IDENTITY_CREATED");
  if(!env.CODE_ENCRYPTION_KEY)throw new HttpError(503,"ENCRYPTION_NOT_CONFIGURED");
  const actor={userId:session?.user.id,email:session?.user.email,emailVerified:session?.user.emailVerified??false,browserId:browser.id,ipAddress:ip};
  const result=await claimCode(env.DB,body,actor,claimServices(env.DB,env,settings.BETTER_AUTH_SECRET));
  return finish(Response.json({...result,emailAvailable:Boolean(env.EMAIL&&settings.EMAIL_FROM&&result.canLink)}));
 }catch(error){
  const code=error instanceof Error?error.message:"";
  if(["CLAIM_UNAVAILABLE","CLAIM_LINK_UNAVAILABLE","CONDITIONS_NOT_MET"].includes(code))return finish(Response.json({error:code},{status:409}));
  if(["CLAIM_LOGIN_REQUIRED","CLAIM_VERIFIED_EMAIL_REQUIRED","CLAIM_IDENTITY_REQUIRED"].includes(code))return finish(Response.json({error:code},{status:401}));
  if(code==="CLAIM_NOT_FOUND")return finish(Response.json({error:code},{status:404}));
  if(code==="QUALIFICATION_UNAVAILABLE")return finish(Response.json({error:code},{status:503}));
  return finish(errorResponse(error));
 }
}
