"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {Button} from "@/components/motion/button/base";
import {Input} from "@/components/motion/input";
import {Checkbox} from "@/components/motion/checkbox";
import {Choice} from "@/components/inventory/choice";
import {Notice} from "@/components/dashboard/notice";
export function SalesSettings({productId,slug,batchId,allowPromotionCodes,stripeProductId,batches,hasPrice,stripeConfigured}:{productId:string;slug:string;batchId:string|null;allowPromotionCodes:boolean;stripeProductId:string|null;batches:{id:string;name:string}[];hasPrice:boolean;stripeConfigured:boolean}){
 const t=useTranslations("sales"),router=useRouter();const[selected,setSelected]=useState(batchId??"none");const[stripeProduct,setStripeProduct]=useState(stripeProductId??"");const[promotions,setPromotions]=useState(allowPromotionCodes);const[busy,setBusy]=useState(false),[error,setError]=useState(false),[saved,setSaved]=useState(false);
 async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError(false);setSaved(false);try{const response=await fetch(`/api/products/${productId}/sales`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({batchId:selected==='none'?null:selected,allowPromotionCodes:promotions,stripeProductId:stripeProduct.trim()||null})});if(!response.ok)throw new Error();setSaved(true);router.refresh();}catch{setError(true);}finally{setBusy(false);}}
 return <section className="space-y-5"><div className="space-y-1"><h2 className="text-[15px] font-semibold">{t("title")}</h2><p className="text-sm text-muted-foreground">{t("description")}</p></div>{!stripeConfigured&&<Notice variant="warning">{t("stripeMissing")}</Notice>}{!hasPrice&&<Notice variant="info">{t("priceMissing")}</Notice>}<form onSubmit={submit} className="space-y-5"><Choice label={t("batch")} value={selected} onChange={setSelected} disabled={busy} options={[{value:"none",label:t("disabled")},...batches.map(b=>({value:b.id,label:b.name}))]}/><Input label={t("stripeProduct")} value={stripeProduct} onChange={setStripeProduct} disabled={busy} maxLength={255}/><p className="text-sm text-muted-foreground">{t("stripeProductHint")}</p><Checkbox checked={promotions} onCheckedChange={value=>setPromotions(value===true)} disabled={busy} label={t("promotions")}/><p className="text-sm text-muted-foreground">{t("promotionsHint")}</p><Button type="submit" disabled={busy||(selected!=='none'&&!hasPrice)}>{t(busy?"working":"save")}</Button>{error&&<Notice variant="destructive">{t("failed")}</Notice>}{saved&&<Notice variant="success" role="status">{t("saved")}</Notice>}</form>{batchId&&<Link className="inline-block underline" href={`/buy/${slug}`}>{t("view")} ↗</Link>}</section>;
}
