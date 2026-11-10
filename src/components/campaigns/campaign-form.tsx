"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {useTranslations} from "next-intl";
import {Input} from "@/components/motion/input";
import {Button} from "@/components/motion/button/base";
import {Choice} from "@/components/inventory/choice";
import {ConditionEditor,localDate} from "./condition-editor";
import {parseCondition,type Condition} from "@/lib/domain/conditions";
import type {Campaign} from "@/lib/server/campaigns";
import {Notice} from "@/components/dashboard/notice";
export function CampaignForm({productId,batches,campaign}:{productId:string;batches:{id:string;name:string}[];campaign?:Campaign}){
 const t=useTranslations("campaigns");const router=useRouter();
 const[name,setName]=useState(campaign?.name??"");const[slug,setSlug]=useState(campaign?.slug??"");const[description,setDescription]=useState(campaign?.description??"");
 const[batchId,setBatchId]=useState(campaign?.batch_id??batches[0]?.id??"");const[visibility,setVisibility]=useState(campaign?.visibility??"public");const[authMode,setAuthMode]=useState(campaign?.auth_mode??"anonymous");
 const[startsAt,setStartsAt]=useState(localDate(campaign?.starts_at));const[endsAt,setEndsAt]=useState(localDate(campaign?.ends_at));const[total,setTotal]=useState(campaign?.total_limit?.toString()??"");const[perPerson,setPerPerson]=useState(String(campaign?.per_person_limit??1));
 const[conditions,setConditions]=useState<Condition>(campaign?.conditions??{type:"always"});
 const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[notice,setNotice]=useState("");
 async function submit(event:FormEvent){
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try{
   parseCondition(conditions);
   const data={productId,batchId,name,slug,description,visibility,authMode,startsAt:startsAt?new Date(startsAt).getTime():null,endsAt:endsAt?new Date(endsAt).getTime():null,totalLimit:total?Number(total):null,perPersonLimit:Number(perPerson),conditions};
   const response=await fetch(campaign?`/api/campaigns/${campaign.id}`:"/api/campaigns",{method:campaign?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(campaign?{version:campaign.version,campaign:data}:data)});
   if(!response.ok){const result=await response.json() as {error?:string};setError(t(result.error==="CAMPAIGN_CONFLICT"?"conflict":"invalid"));return;}
   const result=await response.json() as {id:string};setNotice(t("saved"));
   if(!campaign)router.push(`/dashboard/campaigns/${result.id}`);router.refresh();
  }catch{setError(t("invalid"));}finally{setBusy(false);}
 }
 return <form onSubmit={submit} className="space-y-6"><fieldset disabled={busy} className="space-y-6">
  <div className="grid gap-5 sm:grid-cols-2"><Input label={t("name")} value={name} onChange={setName} required maxLength={120}/><Input label={t("slug")} value={slug} onChange={setSlug} required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*"/></div>
  <Input label={t("description")} value={description} onChange={setDescription} maxLength={2000}/>
  <Choice label={t("batch")} value={batchId} onChange={setBatchId} disabled={!!campaign||busy} options={batches.map(b=>({value:b.id,label:b.name}))}/>
  <div className="grid gap-5 sm:grid-cols-2"><Choice label={t("visibility")} value={visibility} onChange={v=>setVisibility(v as typeof visibility)} disabled={busy} options={["public","private"].map(v=>({value:v,label:t(v)}))}/><Choice label={t("authMode")} value={authMode} onChange={v=>setAuthMode(v as typeof authMode)} disabled={busy} options={["anonymous","email","account"].map(v=>({value:v,label:t(v)}))}/></div>
  <div className="grid gap-5 sm:grid-cols-2"><Input type="datetime-local" label={t("startsAt")} value={startsAt} onChange={setStartsAt}/><Input type="datetime-local" label={t("endsAt")} value={endsAt} onChange={setEndsAt}/><Input type="number" min={1} max={1000000} label={t("totalLimit")} value={total} onChange={setTotal}/><Input type="number" min={1} max={1000} label={t("perPersonLimit")} value={perPerson} onChange={setPerPerson} required/></div>
  <section className="space-y-3"><h2 className="text-base font-semibold">{t("conditions")}</h2><p className="text-sm text-muted-foreground">{t("conditionsHint")}</p><ConditionEditor value={conditions} onChange={setConditions}/></section>
  <Button type="submit" disabled={busy||!batchId}>{t(busy?"working":campaign?"save":"create")}</Button>
 </fieldset>{error&&<Notice variant="destructive">{error}</Notice>}{notice&&<Notice variant="success">{notice}</Notice>}</form>;
}
export function CampaignStatus({campaign}:{campaign:Campaign}){
 const t=useTranslations("campaigns");const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState("");
 return <div className="space-y-3"><Choice label={t("status")} value={campaign.status} disabled={busy} options={["draft","active","paused","archived"].map(v=>({value:v,label:t(v)}))} onChange={async status=>{
  setBusy(true);setError("");try{const r=await fetch(`/api/campaigns/${campaign.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:campaign.version,status})});if(!r.ok)throw new Error();router.refresh();}catch{setError(t("conflict"));}finally{setBusy(false);}
 }}/>{error&&<Notice variant="destructive">{error}</Notice>}</div>;
}
