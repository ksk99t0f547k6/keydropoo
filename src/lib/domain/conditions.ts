import { z } from "zod";

const identifier = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const answer = z.union([z.string().max(2000), z.array(z.string().max(200)).max(30)]);
const leafSchema = z.discriminatedUnion("type", [
 z.object({ type:z.literal("always") }).strict(),
 z.object({ type:z.literal("authenticated") }).strict(),
 z.object({ type:z.literal("verified_email") }).strict(),
 z.object({ type:z.literal("email"), addresses:z.array(z.email().max(254)).min(1).max(100) }).strict(),
 z.object({ type:z.literal("email_domain"), domains:z.array(z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i)).min(1).max(100) }).strict(),
 z.object({ type:z.literal("passphrase"), credentialId:identifier }).strict(),
 z.object({ type:z.literal("invitation"), credentialId:identifier }).strict(),
 z.object({ type:z.literal("time"), startsAt:z.number().int().nonnegative().optional(), endsAt:z.number().int().nonnegative().optional() }).strict().refine(v=>(v.startsAt!==undefined||v.endsAt!==undefined)&&(v.startsAt===undefined||v.endsAt===undefined||v.startsAt<v.endsAt)),
 z.object({ type:z.literal("purchase"), productId:z.uuid(), minimum:z.number().int().min(1).max(10000).default(1) }).strict(),
 z.object({ type:z.literal("question"), id:identifier, label:z.string().min(1).max(500), kind:z.enum(["text","single","multiple"]), required:z.boolean(), options:z.array(z.string().min(1).max(200)).max(30).default([]), correct:answer.optional() }).strict().superRefine((v,ctx)=>{
  const invalid=()=>ctx.addIssue({code:"custom",message:"INVALID_QUESTION"});
  if(new Set(v.options).size!==v.options.length)invalid();
  if(v.kind==="text") { if(v.options.length||Array.isArray(v.correct))invalid(); }
  else {
   if(v.options.length<2)invalid();
   if(v.correct!==undefined){
    if((v.kind==="multiple")!==Array.isArray(v.correct))invalid();
    const values=Array.isArray(v.correct)?v.correct:[v.correct];
    if(!values.length||new Set(values).size!==values.length||values.some(x=>!v.options.includes(x)))invalid();
   }
  }
 }),
 z.object({ type:z.literal("external"), hookId:identifier }).strict(),
]);
export type ConditionLeaf=z.infer<typeof leafSchema>;
export type Condition=ConditionLeaf|{type:"and"|"or";children:Condition[]};
const schema:z.ZodType<Condition>=z.lazy(()=>z.union([leafSchema,z.object({type:z.enum(["and","or"]),children:z.array(schema).min(1).max(20)}).strict()]));

// 在遞迴 schema 前限制深度與節點數，避免惡意輸入耗盡堆疊。
export function parseCondition(raw:unknown):Condition {
 const pending:{value:unknown;depth:number}[]=[{value:raw,depth:1}];let count=0;
 while(pending.length){
  const {value,depth}=pending.pop()!;
  if(++count>100||depth>8)throw new Error("CONDITION_TOO_COMPLEX");
  if(value&&typeof value==="object"&&"children" in value&&Array.isArray(value.children))for(const child of value.children)pending.push({value:child,depth:depth+1});
 }
 const result=schema.parse(raw);const ids=new Set<string>();
 function check(node:Condition){if(node.type==="and"||node.type==="or")node.children.forEach(check);else if(node.type==="question"){if(ids.has(node.id))throw new Error("DUPLICATE_QUESTION");ids.add(node.id);}}
 check(result);return result;
}

export interface ConditionContext {
 // 此部分只能由伺服器 session 與已驗證聯絡資料建立，不能由領取 JSON 複製。
 identity?:{userId?:string;email?:string;emailVerified:boolean};
 now:number;
 answers:Record<string,unknown>;
 passphrases:Record<string,string>;
 invitations:Record<string,string>;
 purchasedCount:(productId:string)=>Promise<number>;
 verifyCredential:(id:string,value:string,kind:"passphrase"|"invitation")=>Promise<boolean>;
 qualify:(hookId:string,signal:AbortSignal)=>Promise<{allowed:boolean}>;
 timeoutMs?:number;
}
export type ConditionResult={allowed:true}|{allowed:false;reason:"CONDITIONS_NOT_MET"|"QUALIFICATION_UNAVAILABLE";retryable:boolean};
const deny:ConditionResult={allowed:false,reason:"CONDITIONS_NOT_MET",retryable:false};
const unavailable:ConditionResult={allowed:false,reason:"QUALIFICATION_UNAVAILABLE",retryable:true};

export async function evaluateCondition(raw:unknown,ctx:ConditionContext):Promise<ConditionResult>{
 const condition=parseCondition(raw);
 const controller=new AbortController();
 const ms=Math.max(1,Math.min(10000,ctx.timeoutMs??3000));let timer:ReturnType<typeof setTimeout>|undefined;
 async function evaluate(node:Condition):Promise<ConditionResult>{
  if(controller.signal.aborted)return unavailable;
  if(node.type==="and"||node.type==="or"){
   let uncertain=false;
   for(const child of node.children){
    const result=await evaluate(child);
    if(node.type==="and"&&!result.allowed&&!result.retryable)return deny;
    if(node.type==="or"&&result.allowed)return result;
    if(!result.allowed&&result.retryable)uncertain=true;
   }
   if(uncertain)return unavailable;
   return node.type==="and"?{allowed:true}:deny;
  }
  let ok=false;const identity=ctx.identity;
  switch(node.type){
   case "always":ok=true;break;
   case "authenticated":ok=!!identity?.userId;break;
   case "verified_email":ok=!!identity?.email&&identity.emailVerified;break;
   case "email":ok=!!identity?.email&&identity.emailVerified&&node.addresses.some(v=>v.toLowerCase()===identity.email!.toLowerCase());break;
   case "email_domain":ok=!!identity?.email&&identity.emailVerified&&node.domains.some(v=>v.toLowerCase()===identity.email!.split("@")[1]?.toLowerCase());break;
   case "time":ok=(node.startsAt===undefined||ctx.now>=node.startsAt)&&(node.endsAt===undefined||ctx.now<node.endsAt);break;
   case "purchase":ok=!!identity?.userId&&(await ctx.purchasedCount(node.productId))>=node.minimum;break;
   case "passphrase":case "invitation":{
    const values=node.type==="passphrase"?ctx.passphrases:ctx.invitations;
    const value=Object.hasOwn(values,node.credentialId)?values[node.credentialId]:undefined;
    ok=typeof value==="string"&&value.length>0&&value.length<=512&&await ctx.verifyCredential(node.credentialId,value,node.type);break;
   }
   case "question":{
    const value=Object.hasOwn(ctx.answers,node.id)?ctx.answers[node.id]:undefined;
    const empty=value===undefined||value===""||(Array.isArray(value)&&value.length===0);
    if(empty){ok=!node.required&&node.correct===undefined;break;}
    if(node.kind==="multiple"){
     ok=Array.isArray(value)&&value.length<=30&&new Set(value).size===value.length&&value.every(v=>typeof v==="string"&&node.options.includes(v));
     if(ok&&Array.isArray(value)&&node.correct!==undefined)ok=Array.isArray(node.correct)&&value.length===node.correct.length&&node.correct.every(v=>value.includes(v));
    }else{
     ok=typeof value==="string"&&value.length<=2000&&!!value.trim()&&(node.kind==="text"||node.options.includes(value));
     if(ok&&node.correct!==undefined)ok=value===node.correct;
    }
    break;
   }
   case "external":{
    const result=await ctx.qualify(node.hookId,controller.signal);
    if(typeof result?.allowed!=="boolean")return unavailable;
    ok=result.allowed;break;
   }
  }
  return ok?{allowed:true}:deny;
 }
 try{
  return await Promise.race([
   evaluate(condition).catch(()=>unavailable),
   new Promise<ConditionResult>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(unavailable);},ms);}),
  ]);
 }finally{if(timer)clearTimeout(timer);controller.abort();}
}

// 公開領取頁只取得表單欄位，不傳送標準答案、信箱名單或資格整合識別。
export function conditionFields(raw:unknown){
 const root=parseCondition(raw);
 const questions:Omit<Extract<ConditionLeaf,{type:"question"}>,"correct">[]=[];
 const credentials:{type:"passphrase"|"invitation";id:string}[]=[];
 function visit(node:Condition){
  if(node.type==="and"||node.type==="or")node.children.forEach(visit);
  else if(node.type==="question"){const {correct,...field}=node;void correct;questions.push(field);}
  else if(node.type==="passphrase"||node.type==="invitation"){
   if(!credentials.some(v=>v.id===node.credentialId&&v.type===node.type))credentials.push({type:node.type,id:node.credentialId});
  }
 }
 visit(root);return {questions,credentials};
}
