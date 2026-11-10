"use client";
import {useTranslations} from "next-intl";
import {Input} from "@/components/motion/input";
import {Button} from "@/components/motion/button/base";
import {Checkbox} from "@/components/motion/checkbox";
import {Choice} from "@/components/inventory/choice";
import type {Condition} from "@/lib/domain/conditions";
const types=["always","and","or","authenticated","verified_email","email","email_domain","passphrase","invitation","time","purchase","question","external"] as const;
function initial(type:typeof types[number]):Condition{
 switch(type){
  case "and":case "or":return {type,children:[{type:"authenticated"}]};
  case "email":return {type,addresses:[]};
  case "email_domain":return {type,domains:[]};
  case "passphrase":case "invitation":return {type,credentialId:""};
  case "time":return {type,startsAt:0};
  case "purchase":return {type,productId:"",minimum:1};
  case "question":return {type,id:crypto.randomUUID(),label:"",kind:"text",required:true,options:[]};
  case "external":return {type,hookId:""};
  default:return {type};
 }
}
export function localDate(value:number|undefined|null){if(value===undefined||value===null)return "";const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function ConditionEditor({value,onChange,depth=1}:{value:Condition;onChange:(v:Condition)=>void;depth?:number}){
 const t=useTranslations("campaigns.rules");
 const lines=(label:string,values:string[],change:(v:string[])=>void)=><label className="block text-sm">{label}<textarea className="mt-2 min-h-24 w-full rounded-lg border border-border bg-background p-3" value={values.join("\n")} onChange={e=>change(e.target.value.split("\n"))}/></label>;
 return <div className="space-y-4 rounded-lg border border-border p-4">
  <Choice label={t("type")} value={value.type} onChange={v=>onChange(initial(v as typeof types[number]))} options={types.filter(type=>depth<8||(type!=="and"&&type!=="or")).map(type=>({value:type,label:t(type)}))}/>
  {(value.type==="and"||value.type==="or")&&<div className="space-y-4">{value.children.map((child,index)=><div key={index} className="space-y-2"><ConditionEditor value={child} depth={depth+1} onChange={v=>onChange({...value,children:value.children.map((c,i)=>i===index?v:c)})}/><Button type="button" variant="ghost" disabled={value.children.length===1} onClick={()=>onChange({...value,children:value.children.filter((_,i)=>i!==index)})}>{t("remove")}</Button></div>)}<Button type="button" variant="outline" disabled={value.children.length>=20} onClick={()=>onChange({...value,children:[...value.children,{type:"authenticated"}]})}>{t("add")}</Button></div>}
  {value.type==="email"&&lines(t("addresses"),value.addresses,addresses=>onChange({...value,addresses}))}
  {value.type==="email_domain"&&lines(t("domains"),value.domains,domains=>onChange({...value,domains}))}
  {(value.type==="passphrase"||value.type==="invitation")&&<Input label={t("credentialId")} value={value.credentialId} onChange={credentialId=>onChange({...value,credentialId})} required maxLength={120}/>}
  {value.type==="time"&&<div className="grid gap-4 sm:grid-cols-2"><Input type="datetime-local" label={t("startsAt")} value={localDate(value.startsAt)} onChange={v=>onChange({...value,startsAt:v?new Date(v).getTime():undefined})}/><Input type="datetime-local" label={t("endsAt")} value={localDate(value.endsAt)} onChange={v=>onChange({...value,endsAt:v?new Date(v).getTime():undefined})}/></div>}
  {value.type==="purchase"&&<><Input label={t("productId")} value={value.productId} onChange={productId=>onChange({...value,productId})} required/><Input type="number" min={1} max={10000} label={t("minimum")} value={String(value.minimum)} onChange={v=>onChange({...value,minimum:Number(v)})}/></>}
  {value.type==="external"&&<><Input label={t("hookId")} value={value.hookId} onChange={hookId=>onChange({...value,hookId})} required/><p className="text-sm text-muted-foreground">{t("hookHint")}</p></>}
  {value.type==="question"&&<>
   <Input label={t("questionLabel")} value={value.label} onChange={label=>onChange({...value,label})} required maxLength={500}/>
   <Input label={t("questionId")} value={value.id} onChange={id=>onChange({...value,id})} required maxLength={120}/>
   <Choice label={t("questionKind")} value={value.kind} options={["text","single","multiple"].map(v=>({value:v,label:t(v)}))} onChange={v=>onChange({...value,kind:v as "text"|"single"|"multiple",options:v==="text"?[]:["", ""],correct:undefined})}/>
   <Checkbox label={t("required")} checked={value.required} onCheckedChange={required=>onChange({...value,required})}/>
   {value.kind!=="text"&&lines(t("options"),value.options,options=>onChange({...value,options}))}
   <Checkbox label={t("checkAnswer")} checked={value.correct!==undefined} onCheckedChange={checked=>onChange({...value,correct:checked?(value.kind==="multiple"?[]:""):undefined})}/>
   {value.correct!==undefined&&(value.kind==="multiple"?lines(t("correctAnswers"),Array.isArray(value.correct)?value.correct:[],correct=>onChange({...value,correct})):<Input label={t("correctAnswer")} value={typeof value.correct==="string"?value.correct:""} onChange={correct=>onChange({...value,correct})}/>)}
  </>}
 </div>;
}
