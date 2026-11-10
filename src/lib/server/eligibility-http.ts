import {resolve4,resolve6} from "node:dns/promises";
import {isIP} from "node:net";
import {z} from "zod";
export interface EligibilityIdentity {userId?:string;email?:string;emailVerified:boolean;}
export interface EligibilityContext {campaignId:string;productId:string;actor:EligibilityIdentity;signal:AbortSignal;}
export interface EligibilityEndpoint {url:string;secretName?:string;shareEmail?:boolean;}
export function endpointUrl(value:string){
 const url=new URL(value);
 if(url.protocol!=="https:"||url.username||url.password||url.hash||url.search||(url.port&&url.port!=="443")||isIP(url.hostname)||!url.hostname.includes(".")||url.hostname.endsWith(".")||/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(url.hostname)||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(url.hostname))throw new Error("INVALID_ELIGIBILITY_ENDPOINT");
 return url;
}
export function isPublicAddress(ip:string){
 if(isIP(ip)===4){
  const [a,b,c]=ip.split(".").map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
 }
 if(isIP(ip)===6)return /^[23][a-f0-9]{3}:/i.test(ip)&&!/^(?:2002|3fff):|^2001:(?:0*:|0*2:|0*db8:|0*[12][0-9a-f]:)/i.test(ip);
 return false;
}
export async function resolvePublic(hostname:string){
 const results=await Promise.allSettled([resolve4(hostname),resolve6(hostname)]);
 const addresses:string[]=[];
 for(const result of results){
  if(result.status==="fulfilled")addresses.push(...result.value);
  else if(!["ENODATA","ENOTFOUND"].includes((result.reason as {code?:string})?.code??""))throw new Error("ELIGIBILITY_DNS_UNAVAILABLE");
 }
 return addresses;
}
interface Dependencies {fetch:typeof fetch;resolve:(hostname:string)=>Promise<string[]>;}
export async function checkHttpEligibility(endpoint:EligibilityEndpoint,context:EligibilityContext,secrets:Readonly<Record<string,string>>,dependencies:Dependencies={fetch,resolve:resolvePublic}){
 const url=endpointUrl(endpoint.url);context.signal.throwIfAborted();
 const addresses=await dependencies.resolve(url.hostname);context.signal.throwIfAborted();
 if(!addresses.length||addresses.some(ip=>!isPublicAddress(ip)))throw new Error("ELIGIBILITY_DESTINATION_BLOCKED");
 const headers:Record<string,string>={"Content-Type":"application/json","Accept":"application/json"};
 if(endpoint.secretName){const secret=Object.hasOwn(secrets,endpoint.secretName)?secrets[endpoint.secretName]:undefined;if(!secret||/[\r\n]/.test(secret))throw new Error("ELIGIBILITY_SECRET_MISSING");headers.Authorization=`Bearer ${secret}`;}
 const identity={userId:context.actor.userId,emailVerified:context.actor.emailVerified,...(endpoint.shareEmail&&context.actor.emailVerified?{email:context.actor.email}:{})};
 // 原生 Workers fetch 需要全域 this；依賴物件的方法呼叫必須明確綁定。
 // Workers 不支援 redirect:error；manual 不跟隨轉址，後續拒絕非 2xx。
 const response=await dependencies.fetch.call(globalThis,url,{method:"POST",headers,body:JSON.stringify({version:1,campaignId:context.campaignId,productId:context.productId,identity}),redirect:"manual",signal:context.signal,cache:"no-store"});
 if(!response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")??"")){await response.body?.cancel();throw new Error("ELIGIBILITY_RESPONSE_INVALID");}
 const reader=response.body?.getReader();if(!reader)throw new Error("ELIGIBILITY_RESPONSE_INVALID");
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){context.signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw new Error("ELIGIBILITY_RESPONSE_TOO_LARGE");chunks.push(value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const result=z.object({allowed:z.boolean(),reason:z.string().max(500).optional()}).strict().parse(JSON.parse(new TextDecoder().decode(bytes)));
 // 原始原因只屬整合回應，不直接呈現可能含個資或內部資訊的文字。
 return {allowed:result.allowed};
}
export function eligibilitySecrets(raw:string|undefined):Readonly<Record<string,string>>{
 if(!raw)return {};return z.record(z.string().regex(/^[A-Z0-9_]+$/),z.string().min(1).max(4096)).parse(JSON.parse(raw));
}
