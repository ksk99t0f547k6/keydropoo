import {z} from 'zod';
import {endpointUrl,isPublicAddress,resolvePublic} from './eligibility-http';
import {webhookSignature,webhookSecrets} from './webhook-http';

export const externalGrantInput=z.object({
 operationId:z.uuid(),productId:z.uuid(),codeId:z.uuid(),userId:z.string().min(1).max(128),
 action:z.literal("revoke").optional(),originalOperationId:z.uuid().optional(),
 reward:z.record(z.string().min(1).max(80),z.json()),
}).strict().refine(value=>(value.action===undefined)===(value.originalOperationId===undefined)&&value.operationId!==value.originalOperationId,"INVALID_EXTERNAL_OPERATION");
export type ExternalGrant=z.infer<typeof externalGrantInput>;
export interface ExternalRewardEndpoint {url:string;secretName:string;}
export type ExternalRewardReceipt={operationId:string;status:'applied'|'rejected'};
export type ExternalRewardHook=(request:ExternalGrant&{signal:AbortSignal})=>Promise<ExternalRewardReceipt>;
export interface ExternalRewardRegistry {
 endpoints:Readonly<Record<string,ExternalRewardEndpoint>>;
 hooks:Readonly<Record<string,ExternalRewardHook>>;
 secrets:Readonly<Record<string,string>>;
}
interface Dependencies {fetch:typeof fetch;resolve:(hostname:string)=>Promise<string[]>;now:()=>number;timeoutMs:number;}
const receipt=z.object({operationId:z.uuid(),status:z.enum(['applied','rejected'])}).strict();
export const externalRewardSecrets=webhookSecrets;

async function readReceipt(response:Response,signal:AbortSignal){
 if(!response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){
  void response.body?.cancel().catch(()=>{});throw new Error('EXTERNAL_REWARD_RESPONSE_INVALID');
 }
 const reader=response.body?.getReader();if(!reader)throw new Error('EXTERNAL_REWARD_RESPONSE_INVALID');
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 let size=0;const chunks:Uint8Array[]=[];
 try{
  for(;;){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.length;if(size>4096)throw new Error('EXTERNAL_REWARD_RESPONSE_INVALID');chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return receipt.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 }catch{cancel();throw new Error('EXTERNAL_REWARD_RESPONSE_INVALID');}
 finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}

// 此層不重試、不標記兌換；呼叫者必須先持久化 operationId，所有重試沿用同一 ID 與本文。
export function externalRewardDispatcher(registry:ExternalRewardRegistry,overrides:Partial<Dependencies>={}){
 const deps:Dependencies={fetch,resolve:resolvePublic,now:Date.now,timeoutMs:5000,...overrides};
 return async(integrationId:string,raw:unknown):Promise<ExternalRewardReceipt>=>{
  z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).parse(integrationId);
  const input=externalGrantInput.parse(raw);
  const body=JSON.stringify({...input,version:1});
  if(new TextEncoder().encode(body).length>16384)throw new Error('EXTERNAL_REWARD_REQUEST_TOO_LARGE');
  const hook=Object.hasOwn(registry.hooks,integrationId)?registry.hooks[integrationId]:undefined;
  const endpoint=Object.hasOwn(registry.endpoints,integrationId)?registry.endpoints[integrationId]:undefined;
  if(Boolean(hook)===Boolean(endpoint))throw new Error('EXTERNAL_REWARD_NOT_CONFIGURED');
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new Error('EXTERNAL_REWARD_TIMEOUT'));controller.abort();},deps.timeoutMs);});
  try{
   return await Promise.race([timeout,(async()=>{
    let result:ExternalRewardReceipt;
    if(hook)result=receipt.parse(await hook({...input,signal:controller.signal}));
    else{
     const url=endpointUrl(endpoint!.url);
     const secret=Object.hasOwn(registry.secrets,endpoint!.secretName)?registry.secrets[endpoint!.secretName]:undefined;
     if(!secret||!/^[a-f0-9]{64}$/i.test(secret))throw new Error('EXTERNAL_REWARD_NOT_CONFIGURED');
     const addresses=await deps.resolve(url.hostname);controller.signal.throwIfAborted();
     if(!addresses.length||addresses.some(ip=>!isPublicAddress(ip)))throw new Error('EXTERNAL_REWARD_DESTINATION_BLOCKED');
     const signature=await webhookSignature(secret,Math.floor(deps.now()/1000),body);controller.signal.throwIfAborted();
     // 原生 Workers fetch 需要全域 this；依賴物件的方法呼叫必須明確綁定。
     // Workers 不支援 redirect:error；manual 保留 3xx，由回應檢查判為失敗。
     const response=await deps.fetch.call(globalThis,url,{method:'POST',body,redirect:'manual',cache:'no-store',signal:controller.signal,
      headers:{'Content-Type':'application/json',Accept:'application/json','Idempotency-Key':input.operationId,'Keydrop-Signature':signature}});
     result=await readReceipt(response,controller.signal);
    }
    controller.signal.throwIfAborted();
    if(result.operationId!==input.operationId)throw new Error('EXTERNAL_REWARD_RESPONSE_INVALID');
    return result;
   })()]);
  }catch(error){
   // 外部例外可能含 token、個資或回應本文；只回傳固定代碼。
   const code=error instanceof Error?error.message:'';
   if(['EXTERNAL_REWARD_NOT_CONFIGURED','EXTERNAL_REWARD_DESTINATION_BLOCKED','EXTERNAL_REWARD_RESPONSE_INVALID','EXTERNAL_REWARD_TIMEOUT'].includes(code))throw new Error(code);
   throw new Error('EXTERNAL_REWARD_UNAVAILABLE');
  }finally{if(timer)clearTimeout(timer);}
 };
}
