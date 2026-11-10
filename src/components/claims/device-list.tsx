"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {useTranslations} from "next-intl";
import {Button} from "@/components/motion/button/base";
import type {listOwnedDevices} from "@/lib/server/licenses";
export function DeviceList({devices}:{devices:Awaited<ReturnType<typeof listOwnedDevices>>}){
 const t=useTranslations("devices");const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState("");
 async function release(activationId:string){setBusy(true);setError("");try{const r=await fetch("/api/license-devices",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({activationId})});if(!r.ok)throw new Error();router.refresh();}catch{setError(t("failed"));}finally{setBusy(false);}}
 return <section className="mt-12 space-y-5 border-t border-border pt-8"><h2>{t("title")}</h2>{!devices.length?<p>{t("empty")}</p>:<ul className="space-y-3">{devices.map(device=><li key={device.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4"><div><p>{device.product_name} · {device.label||t("unnamed")}</p><p className="mt-2 font-mono text-xs text-muted-foreground">{device.id}</p><p className="mt-2 text-sm">{t(device.released_at===null?"bound":"released")}</p></div><Button variant="outline" disabled={busy||device.released_at!==null} onClick={()=>void release(device.id)}>{t("release")}</Button></li>)}</ul>}{error&&<p role="alert">{error}</p>}</section>;
}
