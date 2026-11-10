"use client";
import {useRef,useState} from "react";
import {useTranslations} from "next-intl";
import {Button} from "@/components/motion/button/base";
export function checkoutDestination(url:string){const parsed=new URL(url);if(parsed.protocol!=="https:"||parsed.hostname!=="checkout.stripe.com")throw new Error("INVALID_CHECKOUT_URL");return parsed.href;}
export function BuyButton({productId,available}:{productId:string;available:boolean}){
 const t=useTranslations("purchase"),[busy,setBusy]=useState(false),[error,setError]=useState("");const key=useRef<string|null>(null);
 async function buy(){
  setBusy(true);setError("");const storage=`keydrop-checkout:${productId}`;
  try{
   if(!key.current){try{key.current=sessionStorage.getItem(storage);}catch{}if(!key.current||! /^[a-f0-9-]{36}$/.test(key.current))key.current=crypto.randomUUID();try{sessionStorage.setItem(storage,key.current);}catch{}}
   const send=()=>fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId,idempotencyKey:key.current})});
   let response=await send();if(response.status===428)response=await send();
   const data=await response.json() as {error?:string;orderId:string;url:string|null};
   if(!response.ok){setError(t(data.error==='ORDER_STOCK_UNAVAILABLE'?"soldOut":data.error==='ORDER_PENDING_LIMIT'?"pendingLimit":response.status===429?"limited":"failed"));return;}
   const destination=data.url?checkoutDestination(data.url):`/orders/${data.orderId}`;
   try{sessionStorage.removeItem(storage);}catch{}key.current=null;window.location.assign(destination);
  }catch{setError(t("failed"));}finally{setBusy(false);}
 }
 return <div className="space-y-4"><Button disabled={busy||!available} onClick={buy}>{t(!available?"unavailable":busy?"working":"buy")}</Button><p className="text-sm text-muted-foreground">{t("oneCode")}</p>{error&&<p role="alert">{error}</p>}</div>;
}
