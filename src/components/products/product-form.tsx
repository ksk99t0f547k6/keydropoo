"use client";
import { useState,type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/motion/input";
import { Button } from "@/components/motion/button/base";
import { Checkbox } from "@/components/motion/checkbox";
import { Choice } from "@/components/inventory/choice";
import { fromMinorUnits,toMinorUnits } from "@/lib/domain/money";
import type { ProductRow } from "@/lib/server/inventory";
import {Notice} from "@/components/dashboard/notice";
export function ProductForm({product,onCreated}:{product?:ProductRow;onCreated?:(id:string)=>void}) {
 const t=useTranslations();const router=useRouter();
 const[name,setName]=useState(product?.name??"");const[slug,setSlug]=useState(product?.slug??"");const[description,setDescription]=useState(product?.description??"");
 const[currency,setCurrency]=useState(product?.currency??"USD");const[price,setPrice]=useState(product?fromMinorUnits(product.price_minor,product.currency):"0.00");
 const[policy,setPolicy]=useState(product?.shortage_policy??"refund");const[revoke,setRevoke]=useState(Boolean(product?.revoke_on_refund??true));
 const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[notice,setNotice]=useState("");
 async function submit(event:FormEvent){
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try{
   const priceMinor=toMinorUnits(price,currency);
   const r=await fetch(product?`/api/products/${product.id}`:"/api/products",{method:product?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,slug,description,currency,priceMinor,shortagePolicy:policy,revokeOnRefund:revoke})});
   if(!r.ok){setError(t(r.status===409?"products.duplicate":"errors.generic"));return;}
   if(!product){const created=await r.json() as {id?:string};if(onCreated&&created.id){onCreated(created.id);return;}setName("");setSlug("");setDescription("");}
   setNotice(t("products.saved"));router.refresh();
  }catch(e){setError(t(e instanceof Error&&["INVALID_PRICE","INVALID_CURRENCY"].includes(e.message)?"products.invalidPrice":"errors.generic"));}finally{setBusy(false);}
 }
 return <form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="space-y-5">
  <Input label={t("products.name")} value={name} onChange={setName} required maxLength={120}/><Input label={t("products.slug")} value={slug} onChange={setSlug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80}/><p className="text-sm text-muted-foreground">{t("products.slugHint")}</p>
  <label className="block text-sm">{t("products.details")}<textarea className="mt-2 min-h-24 w-full rounded-xl border border-border bg-card p-3 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring" value={description} onChange={e=>setDescription(e.target.value)} maxLength={2000}/></label>
  <div className="grid grid-cols-2 gap-4"><Input label={t("products.currency")} value={currency} onChange={v=>setCurrency(v.toUpperCase())} minLength={3} maxLength={3} required/><Input label={t("products.price")} value={price} onChange={setPrice} inputMode="decimal" required/></div>
  <Choice label={t("products.shortagePolicy")} value={policy} onChange={v=>setPolicy(v as typeof policy)} options={["refund","manual","backorder"].map(value=>({value,label:t(`products.policy.${value}`)}))} disabled={busy}/>
  <Checkbox checked={revoke} onCheckedChange={setRevoke} label={t("products.revokeOnRefund")}/>
  <div className="pt-1"><Button type="submit" disabled={busy}>{t(busy?"common.working":product?"products.save":"products.create")}</Button></div>
 </fieldset>{error&&<Notice variant="destructive">{error}</Notice>}{notice&&<Notice variant="success">{notice}</Notice>}</form>;
}
export function ArchiveProduct({id,archived}:{id:string;archived:boolean}) {
 const t=useTranslations();const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState(false);
 return <div className="space-y-3"><Button variant="outline" disabled={busy} onClick={async()=>{setBusy(true);setError(false);try{const r=await fetch(`/api/products/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:!archived})});if(!r.ok)throw new Error();router.refresh();}catch{setError(true);}finally{setBusy(false);}}}>{t(archived?"products.restore":"products.archive")}</Button>{error&&<Notice variant="destructive">{t("errors.generic")}</Notice>}</div>;
}
