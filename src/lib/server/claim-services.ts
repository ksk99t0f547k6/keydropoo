import {purchasedOrderCount} from "./orders";
import type {ClaimServices} from "./claims";
import {checkHttpEligibility,eligibilitySecrets} from "./eligibility-http";
import {eligibilityHooks,eligibilityEndpoints} from "@/custom/eligibility";
export function claimServices(db:D1Database,env:{CODE_ENCRYPTION_KEY?:string;ELIGIBILITY_SECRETS?:string},identitySecret:string):ClaimServices{
 return {
  encryptionSecret:env.CODE_ENCRYPTION_KEY??"",identitySecret,
  purchasedCount:(userId,productId)=>purchasedOrderCount(db,userId,productId),
  qualify:async(id,identity,signal,campaign)=>{
   const hook=Object.hasOwn(eligibilityHooks,id)?eligibilityHooks[id]:undefined;
   const endpoint=Object.hasOwn(eligibilityEndpoints,id)?eligibilityEndpoints[id]:undefined;
   if(Boolean(hook)===Boolean(endpoint))throw new Error("ELIGIBILITY_INTEGRATION_NOT_CONFIGURED");
   const context={...campaign,actor:{userId:identity.userId,email:identity.email,emailVerified:identity.emailVerified},signal};
   return hook?hook(context):checkHttpEligibility(endpoint!,context,eligibilitySecrets(env.ELIGIBILITY_SECRETS));
  },
 };
}
