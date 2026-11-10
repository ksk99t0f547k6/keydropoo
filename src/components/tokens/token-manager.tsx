"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {useTranslations,useFormatter} from "next-intl";
import {Button} from "@/components/motion/button/base";
import {Checkbox} from "@/components/motion/checkbox";
import {Input} from "@/components/motion/input";
import type {listApiTokens,ApiScope} from "@/lib/server/api-tokens";
import {Notice} from "@/components/dashboard/notice";

type Token=Awaited<ReturnType<typeof listApiTokens>>[number];
const availableScopes=["discounts:read","discounts:write","licenses:manage","products:read","products:write","rewards:read","rewards:write","codes:read","campaigns:read","codes:write","codes:issue","campaigns:write","credits:read","entitlements:read","credits:write","codes:redeem"] as const;
export function TokenManager({tokens,products,now}:{tokens:Token[];products:{id:string;name:string}[];now:number}){
 const t=useTranslations("tokens"),format=useFormatter(),router=useRouter();
 const[mcpWrite,setMcpWrite]=useState(false);
 const[name,setName]=useState("");const[scopeSet,setScopeSet]=useState<ApiScope[]>(["credits:read","entitlements:read"]);
 const[selected,setSelected]=useState<string[]>([]);const[all,setAll]=useState(false);const[expires,setExpires]=useState("");
 const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[created,setCreated]=useState<{id:string;token:string}|null>(null);const[copied,setCopied]=useState(false);
 const[confirm,setConfirm]=useState<string|null>(null);
 const displayDate=(value:number|null)=>value===null?t("never"):format.dateTime(value,{dateStyle:"medium",timeStyle:"short"});
 async function create(event:FormEvent){
  event.preventDefault();setError("");setBusy(true);
  try{
   const expiresAt=expires?new Date(expires).getTime():null;
   if((expiresAt!==null&&(!Number.isFinite(expiresAt)||expiresAt<=Date.now()))||!scopeSet.length||(!all&&!selected.length)){setError(t("invalid"));return;}
   const response=await fetch("/api/tokens",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mcpWriteEnabled:mcpWrite,scopes:scopeSet,productIds:all?null:selected,expiresAt})});
   if(!response.ok)throw new Error();
   setCreated(await response.json());setCopied(false);setName("");router.refresh();
  }catch{setError(t("failed"));}finally{setBusy(false);}
 }
 async function revoke(id:string){
  setBusy(true);setError("");
  try{const response=await fetch("/api/tokens",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});if(!response.ok)throw new Error();if(created?.id===id)setCreated(null);setConfirm(null);router.refresh();}catch{setError(t("failed"));}finally{setBusy(false);}
 }
 return <div className="space-y-10">
  {error&&<Notice variant="destructive">{error}</Notice>}
  {created&&<section className="rounded-lg border-2 border-foreground p-6 space-y-4" aria-label={t("created")}><h2 className="text-base font-semibold">{t("created")}</h2><p className="text-sm text-muted-foreground">{t("secretHint")}</p><code className="block break-all rounded bg-muted p-4 select-all">{created.token}</code><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={async()=>{try{await navigator.clipboard.writeText(created.token);setCopied(true);}catch{setError(t("copyFailed"));}}}>{t(copied?"copied":"copy")}</Button><Button onClick={()=>setCreated(null)}>{t("dismiss")}</Button></div></section>}
  <form onSubmit={create} className="rounded-lg border border-border p-6"><fieldset disabled={busy||created!==null} className="space-y-6"><legend className="mb-5 text-xl">{t("create")}</legend>
   <div className="grid gap-5 md:grid-cols-2"><Input label={t("name")} required maxLength={120} value={name} onChange={setName}/><Input label={t("expires")} type="datetime-local" value={expires} onChange={setExpires}/></div>
   <p className="text-sm text-muted-foreground">{t("expiryHint")}</p>
   <fieldset className="space-y-3"><legend className="mb-3 font-medium">{t("products")}</legend><Checkbox checked={all} onCheckedChange={setAll} label={t("allProducts")} description={t("allHint")}/><div className="grid gap-3 sm:grid-cols-2">{products.map(p=><Checkbox key={p.id} disabled={all||busy||created!==null} checked={selected.includes(p.id)} onCheckedChange={checked=>setSelected(current=>checked?[...current,p.id]:current.filter(id=>id!==p.id))} label={p.name}/>)}</div>{!products.length&&<p className="text-sm text-muted-foreground">{t("noProducts")}</p>}</fieldset>
   <fieldset className="space-y-3"><legend className="mb-3 font-medium">{t("permissions")}</legend><p className="text-sm text-muted-foreground">{t("permissionsHint")}</p><div className="grid gap-4 sm:grid-cols-2">{availableScopes.map(scope=><Checkbox key={scope} checked={scopeSet.includes(scope)} onCheckedChange={checked=>setScopeSet(current=>checked?[...current,scope]:current.filter(s=>s!==scope))} label={t(`scope.${scope}`)} description={scope}/>)}</div></fieldset>
   <Checkbox checked={mcpWrite} onCheckedChange={setMcpWrite} label={t("mcpWrite")} description={t("mcpWriteHint")}/>
   <Button type="submit" disabled={busy||created!==null||!scopeSet.length||(!all&&!selected.length)}>{t(busy?"working":"create")}</Button>
  </fieldset></form>
  <section className="space-y-4"><h2 className="text-base font-semibold">{t("existing")}</h2>{!tokens.length&&<p className="text-muted-foreground">{t("empty")}</p>}{tokens.map(token=>{
   const state=token.revoked_at!==null?"revoked":token.expires_at!==null&&token.expires_at<=now?"expired":"active";
   return <article key={token.id} className="rounded-lg border border-border p-6 space-y-4"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-medium break-all">{token.name}</h3><span className="text-sm text-muted-foreground">{t(state)}</span></div><p className="text-sm">{token.productIds===null?t("allProducts"):token.productIds.map(id=>products.find(p=>p.id===id)?.name??id).join(", ")}</p><p className="text-sm break-words text-muted-foreground">{token.scopes.join(" · ")}</p><p className="text-sm text-muted-foreground">{t(token.mcp_write_enabled?"mcpWriting":"mcpReadonly")}</p><dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">{t("createdAt")}</dt><dd>{displayDate(token.created_at)}</dd></div><div><dt className="text-muted-foreground">{t("expires")}</dt><dd>{displayDate(token.expires_at)}</dd></div><div><dt className="text-muted-foreground">{t("lastUsed")}</dt><dd>{token.last_used_at===null?t("unused"):displayDate(token.last_used_at)}</dd></div></dl>{token.revoked_at===null&&(confirm===token.id?<div className="space-y-3"><p>{t("confirmRevoke")}</p><div className="flex gap-3"><Button disabled={busy} onClick={()=>revoke(token.id)}>{t("revoke")}</Button><Button variant="outline" disabled={busy} onClick={()=>setConfirm(null)}>{t("cancel")}</Button></div></div>:<Button variant="outline" disabled={busy} onClick={()=>setConfirm(token.id)}>{t("revoke")}</Button>)}</article>;
  })}</section>
 </div>;
}
