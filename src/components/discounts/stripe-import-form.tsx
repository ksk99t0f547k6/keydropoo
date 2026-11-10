'use client';
import {useState,type FormEvent} from 'react';
import Link from 'next/link';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/motion/button/base';
import {Input} from '@/components/motion/input';
import {Choice} from '@/components/inventory/choice';
import type {StripeDiscountScope} from '@/lib/server/stripe-discount-service';
import {Notice} from '@/components/dashboard/notice';
type ImportResult={promotionId:string;batchId?:string;error?:string};
export function StripeImportForm({productId,onImported}:{productId:string;onImported:(batchId:string)=>void}){
 const t=useTranslations('stripeImport'),[scope,setScope]=useState<StripeDiscountScope|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[results,setResults]=useState<ImportResult[]>([]);
 const[promotionId,setPromotionId]=useState(''),[name,setName]=useState(''),[mode,setMode]=useState('shared'),[limit,setLimit]=useState('');
 function errorText(code:string){return t(code==='STRIPE_NOT_CONFIGURED'?'notConfigured':code==='STRIPE_CONNECTION_CHANGED'?'changed':code==='STRIPE_INVENTORY_CONFLICT'?'conflict':code==='DUPLICATE_CODES'?'duplicate':code==='STRIPE_INVENTORY_UNAVAILABLE'?'unavailable':code==='INVALID_INPUT'?'invalid':'failed');}
 function failure(error:unknown){setError(errorText(error instanceof Error?error.message:''));}
 async function connect(){setBusy(true);setError('');try{const response=await fetch('/api/admin/stripe-discounts');const data=await response.json() as StripeDiscountScope&{error?:string};if(!response.ok)throw new Error(data.error);setScope({accountId:data.accountId,livemode:data.livemode});setResults([]);}catch(error){failure(error);}finally{setBusy(false);}}
 async function submit(event:FormEvent){event.preventDefault();if(!scope)return;setBusy(true);setError('');setResults([]);try{
  const sharedClaimLimit=mode==='shared'&&limit?Number(limit):null;
  if(sharedClaimLimit!==null&&(!/^\d+$/.test(limit)||!Number.isSafeInteger(sharedClaimLimit)||sharedClaimLimit<1||sharedClaimLimit>1000000))throw new Error('INVALID_INPUT');
  const promotionIds=[...new Set(promotionId.split(/[\s,]+/).filter(Boolean))];
  if(!promotionIds.length||promotionIds.length>25||promotionIds.some(id=>id.length>255))throw new Error('INVALID_INPUT');
  const response=await fetch('/api/admin/stripe-discounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'importPromotions',expectedScope:scope,input:{productId,promotionIds,name:name.trim(),distributionMode:mode,sharedClaimLimit}})});
  const data=await response.json() as {results:ImportResult[];error?:string};if(!response.ok)throw new Error(data.error);setResults(data.results);const imported=data.results.filter(item=>item.batchId);if(imported.length)onImported(imported.length===1?imported[0].batchId!:'');
 }catch(error){failure(error);}finally{setBusy(false);}}
 return <details className="rounded-xl border border-border p-5"><summary className="cursor-pointer font-medium">{t('title')}</summary><div className="mt-5 space-y-5"><p>{t('description')}</p><Link className="underline" href="/dashboard/stripe-discounts">{t('browse')}</Link><div><Button variant="outline" disabled={busy} onClick={()=>void connect()}>{t(scope?'reconnect':'connect')}</Button></div>{scope&&<form onSubmit={submit} className="space-y-5"><p>{t(scope.livemode?'live':'test',{account:scope.accountId})}</p><Input label={t('promotionId')} value={promotionId} onChange={setPromotionId} required disabled={busy} maxLength={6400}/><Input label={t('name')} value={name} onChange={setName} required disabled={busy} maxLength={120}/><Choice label={t('mode')} value={mode} onChange={setMode} disabled={busy} options={[{value:'shared',label:t('shared')},{value:'unique',label:t('unique')}]}/>{mode==='shared'&&<Input label={t('limit')} type="number" value={limit} onChange={setLimit} min={1} max={1000000} step={1} disabled={busy}/>}<p className="text-sm text-muted-foreground">{t('restrictions')}</p><Button type="submit" disabled={busy}>{t(busy?'working':'submit')}</Button></form>}{results.length>0&&<div role="status" className="space-y-2"><p>{t('summary',{success:results.filter(item=>item.batchId).length,total:results.length})}</p><ul className="space-y-2">{results.map(item=><li key={item.promotionId} className="break-all">{item.promotionId}: {item.batchId?t('success',{id:item.batchId}):errorText(item.error??'')}</li>)}</ul></div>}{error&&<Notice variant="destructive">{error}</Notice>}</div></details>;
}
