"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {useTranslations} from "next-intl";
import {Input} from "@/components/motion/input";
import {Button} from "@/components/motion/button/base";
import type {listCampaignLinks} from "@/lib/server/claims";
import {Notice} from "@/components/dashboard/notice";
export function CampaignLinks({campaignId,publicUrl,links}:{campaignId:string;publicUrl:string;links:Awaited<ReturnType<typeof listCampaignLinks>>}){
 const t=useTranslations("campaigns.links");const router=useRouter();const[expires,setExpires]=useState("");const[max,setMax]=useState("1");const[url,setUrl]=useState("");const[busy,setBusy]=useState(false);const[error,setError]=useState("");
 async function send(method:string,body:unknown){setBusy(true);setError("");try{const r=await fetch(`/api/campaigns/${campaignId}/links`,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error();const data=await r.json() as {url?:string};if(data.url)setUrl(data.url);router.refresh();}catch{setError(t("failed"));}finally{setBusy(false);}}
 return <section className="space-y-5"><h2 className="text-base font-semibold">{t("title")}</h2><a className="break-all underline" href={publicUrl} target="_blank" rel="noreferrer">{t("open")}</a><p className="text-sm text-muted-foreground">{t("hint")}</p>
  <form className="space-y-4" onSubmit={(e:FormEvent)=>{e.preventDefault();void send("POST",{expiresAt:expires?new Date(expires).getTime():null,maxClaims:max?Number(max):null});}}><fieldset disabled={busy} className="space-y-4"><Input type="datetime-local" label={t("expires")} value={expires} onChange={setExpires}/><Input type="number" min={1} max={1000000} label={t("max")} value={max} onChange={setMax}/><Button type="submit" disabled={busy}>{t("create")}</Button></fieldset></form>
  {url&&<div role="status" className="space-y-2 rounded-lg border border-border p-4"><p>{t("created")}</p><a href={url} target="_blank" rel="noreferrer" className="block break-all font-mono text-sm underline">{url}</a></div>}
  <ul className="space-y-3">{links.map(link=><li key={link.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="font-mono text-xs">{link.id}</p><p className="text-sm">{link.claimed_count} / {link.max_claims??"∞"} · {link.expires_at?new Date(link.expires_at).toISOString():t("never")}{link.revoked_at!==null?` · ${t("revoked")}`:""}</p></div><Button type="button" variant="outline" disabled={busy||link.revoked_at!==null} onClick={()=>void send("DELETE",{id:link.id})}>{t("revoke")}</Button></li>)}</ul>{error&&<Notice variant="destructive">{error}</Notice>}
 </section>;
}
