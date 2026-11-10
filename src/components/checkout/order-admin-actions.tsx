"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {useTranslations} from "next-intl";
import {Button} from "@/components/motion/button/base";
import {Notice} from "@/components/dashboard/notice";
export function OrderAdminActions({id,waiting,stripeConfigured}:{id:string;waiting:boolean;stripeConfigured:boolean}){
 const t=useTranslations("adminOrders"),router=useRouter();const[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function run(action:"synchronize"|"fulfill"){setBusy(true);setError("");try{const response=await fetch(`/api/admin/orders/${id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action})});const data=await response.json() as {error?:string};if(!response.ok){setError(t(data.error==='ORDER_STOCK_UNAVAILABLE'?"noStock":"failed"));return;}router.refresh();}catch{setError(t("failed"));}finally{setBusy(false);}}
 return <div className="space-y-3"><div className="flex flex-wrap gap-3">{stripeConfigured&&<Button variant="outline" disabled={busy} onClick={()=>run('synchronize')}>{t("sync")}</Button>}{waiting&&<Button disabled={busy} onClick={()=>run('fulfill')}>{t("fulfill")}</Button>}</div>{error&&<Notice variant="destructive">{error}</Notice>}</div>;
}
