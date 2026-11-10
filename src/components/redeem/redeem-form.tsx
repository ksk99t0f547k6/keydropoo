"use client";
import {useRef,useState,type FormEvent} from "react";
import {useTranslations} from "next-intl";
import {Input} from "@/components/motion/input";
import type {z} from "zod";
import type {rewardSchema} from "@/lib/server/redemptions";
import {Button} from "@/components/motion/button/base";
export function RedeemForm({productId}:{productId:string}){
 const t=useTranslations("redeem");const[code,setCode]=useState("");const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[result,setResult]=useState<{reward:z.infer<typeof rewardSchema>;revoked:boolean}|null>(null);const[reviewCode,setReviewCode]=useState<string|null>(null);const request=useRef<{code:string;key:string}|null>(null);
 async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError("");if(request.current?.code!==code)request.current={code,key:crypto.randomUUID()};try{const r=await fetch("/api/redeem",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId,code,idempotencyKey:request.current.key})});const data=await r.json() as {reward:z.infer<typeof rewardSchema>;revoked:boolean;error?:string};if(!r.ok){if(data.error==="EXTERNAL_REDEMPTION_REVIEW_REQUIRED")setReviewCode(code);setError(t(data.error==="RATE_LIMITED"?"limited":data.error==="REWARD_ALREADY_OWNED"?"alreadyOwned":data.error==="EXTERNAL_REDEMPTION_FAILED"?"externalFailed":data.error==="EXTERNAL_REDEMPTION_REVIEW_REQUIRED"?"externalReview":data.error==="EXTERNAL_REDEMPTION_BUSY"?"externalBusy":"failed"));return;}setResult(data);setCode("");}catch{setError(t("failed"));}finally{setBusy(false);}}
 if(result)return <div role="status" className="space-y-4 rounded-xl border border-border p-6"><h2>{t(result.revoked?"revoked":"success")}</h2><p>{result.reward.kind==="credits"?t("granted",{amount:result.reward.amount,bucket:result.reward.bucket}):result.reward.kind==="membership"?t("membership",{days:result.reward.days,plan:result.reward.plan}):result.reward.kind==="external"?t("externalGranted"):t("permanent",{plan:result.reward.plan})}</p></div>;
 return <form onSubmit={submit} className="space-y-5"><Input label={t("code")} value={code} onChange={setCode} required maxLength={512} autoComplete="off" disabled={busy}/><Button type="submit" disabled={busy||reviewCode===code}>{t(busy?"working":"submit")}</Button>{error&&<p role="alert" className="text-red-600">{error}</p>}</form>;
}
