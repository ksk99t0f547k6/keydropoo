"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {useTranslations} from "next-intl";
import {Input} from "@/components/motion/input";
import {Button} from "@/components/motion/button/base";
import {Choice} from "@/components/inventory/choice";
import {Notice} from "@/components/dashboard/notice";
type Credential={id:string;kind:"passphrase"|"invitation";revoked_at:number|null};
export function CampaignCredentials({campaignId,credentials}:{campaignId:string;credentials:Credential[]}){
 const t=useTranslations("campaigns.credentials");const router=useRouter();
 const[id,setId]=useState("");const[kind,setKind]=useState("passphrase");const[secret,setSecret]=useState("");const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");
 async function send(method:string,body:unknown){
  setBusy(true);setMessage("");
  try{const r=await fetch(`/api/campaigns/${campaignId}/credentials`,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error();setSecret("");setMessage(t("saved"));router.refresh();}catch{setMessage(t("failed"));}finally{setBusy(false);}
 }
 return <section className="space-y-5"><h2 className="text-base font-semibold">{t("title")}</h2><p className="text-sm text-muted-foreground">{t("hint")}</p>
  <ul className="space-y-3">{credentials.map(c=><li key={`${c.kind}:${c.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><span>{c.id} · {t(c.kind)} · {t(c.revoked_at===null?"active":"revoked")}</span><Button type="button" variant="outline" disabled={busy||c.revoked_at!==null} onClick={()=>void send("DELETE",{id:c.id,kind:c.kind})}>{t("revoke")}</Button></li>)}</ul>
  <form className="space-y-4" onSubmit={(event:FormEvent)=>{event.preventDefault();void send("POST",{id,kind,secret});}}><fieldset disabled={busy} className="space-y-4">
   <Input label={t("id")} value={id} onChange={setId} required maxLength={120} pattern="[a-zA-Z0-9_-]+"/>
   <Choice label={t("kind")} value={kind} onChange={setKind} disabled={busy} options={["passphrase","invitation"].map(v=>({value:v,label:t(v)}))}/>
   <Input type="password" label={t("secret")} value={secret} onChange={setSecret} required minLength={8} maxLength={128} autoComplete="new-password"/>
   <Button type="submit" disabled={busy}>{t("save")}</Button>
  </fieldset></form>{message&&<Notice variant="default">{message}</Notice>}
 </section>;
}
