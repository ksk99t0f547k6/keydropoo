import {z} from "zod";
import {endpointUrl,isPublicAddress,resolvePublic} from "./eligibility-http";
import type {WebhookSender} from "./webhook-outbox";
const encoder=new TextEncoder();
export function webhookSecrets(raw:string|undefined):Readonly<Record<string,string>>{
 if(!raw)return {};
 return z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),z.string().regex(/^[a-f0-9]{64}$/i)).parse(JSON.parse(raw));
}
export async function webhookSignature(secret:string,timestamp:number,body:string){
 if(!/^[a-f0-9]{64}$/i.test(secret))throw new Error("WEBHOOK_SECRET_INVALID");
 const key=await crypto.subtle.importKey("raw",Uint8Array.from(secret.match(/../g)!,s=>parseInt(s,16)),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=await crypto.subtle.sign("HMAC",key,encoder.encode(`${timestamp}.${body}`));
 return `t=${timestamp},v1=${Array.from(new Uint8Array(signature),v=>v.toString(16).padStart(2,'0')).join('')}`;
}
interface Dependencies {fetch:typeof fetch;resolve:(hostname:string)=>Promise<string[]>;now:()=>number;timeoutMs:number;}
export function webhookHttpSender(secrets:Readonly<Record<string,string>>,overrides:Partial<Dependencies>={}):WebhookSender{
 const dependencies:Dependencies={fetch,resolve:resolvePublic,now:Date.now,timeoutMs:5000,...overrides};
 return async(target,event)=>{
  const url=endpointUrl(target.url);
  const secret=Object.hasOwn(secrets,target.secretName)?secrets[target.secretName]:undefined;
  if(!secret)throw new Error("WEBHOOK_SECRET_MISSING");
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("WEBHOOK_TIMEOUT"));},dependencies.timeoutMs);});
  try{
   return await Promise.race([timeout,(async()=>{
    const addresses=await dependencies.resolve(url.hostname);controller.signal.throwIfAborted();
    if(!addresses.length||addresses.some(ip=>!isPublicAddress(ip)))throw new Error("WEBHOOK_DESTINATION_BLOCKED");
    const body=JSON.stringify({...event,version:1});
    const signature=await webhookSignature(secret,Math.floor(dependencies.now()/1000),body);controller.signal.throwIfAborted();
    // 原生 Workers fetch 需要全域 this；依賴物件的方法呼叫必須明確綁定。
    // Workers 不支援 redirect:error；manual 保留 3xx，由回應檢查判為失敗。
    const response=await dependencies.fetch.call(globalThis,url,{method:"POST",body,redirect:"manual",cache:"no-store",signal:controller.signal,
     headers:{"Content-Type":"application/json","Keydrop-Event-Id":event.id,"Keydrop-Signature":signature}});
    // 通知只看狀態碼，不讀取或記錄外部回應本文。
    await response.body?.cancel();return response.status;
   })()]);
  }finally{if(timer)clearTimeout(timer);}
 };
}
