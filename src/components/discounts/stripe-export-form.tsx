'use client';
import {useState,type FormEvent} from 'react';
import Link from 'next/link';
import {useTranslations} from 'next-intl';
import {Input} from '@/components/motion/input';
import {Button} from '@/components/motion/button/base';
import {Checkbox} from '@/components/motion/checkbox';
import {discountFormInput,discountOperationKey,emptyDiscountFields,type DiscountFields} from '@/lib/domain/stripe-discount-form';
import type {CodeRow} from '@/lib/server/inventory';
import type {StripeDiscountScope} from '@/lib/server/stripe-discount-service';
import {Notice} from '@/components/dashboard/notice';
export function StripeExportForm({code,onUpdated,onClose}:{code:CodeRow;onUpdated:()=>void;onClose:()=>void}){
 const t=useTranslations('stripeExport'),labels=useTranslations('stripeDiscountCreate');
 const [scope,setScope]=useState<StripeDiscountScope|null>(null),[fields,setFields]=useState({...emptyDiscountFields}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [operation,setOperation]=useState(code.stripe_export_operation_id??''),[result,setResult]=useState<{sourceId:string;linked:boolean}|null>(null);
 const resumeOnly=!!code.stripe_export_operation_id||!!result;
 function failed(e:unknown){const message=e instanceof Error?e.message:'';setError(t(message==='STRIPE_OPERATION_REVIEW_REQUIRED'?'review':message==='STRIPE_CONNECTION_CHANGED'?'changed':message==='STRIPE_INVENTORY_CONFLICT'?'conflict':message==='INVALID_INPUT'?'invalid':message==='STRIPE_INVENTORY_UNAVAILABLE'?'unavailable':'failed'));}
 async function connect(){setBusy(true);setError('');try{const response=await fetch('/api/admin/stripe-discounts');const data=await response.json() as StripeDiscountScope&{error?:string};if(!response.ok)throw new Error(data.error);setScope({accountId:data.accountId,livemode:data.livemode});}catch(e){failed(e);}finally{setBusy(false);}}
 function field(key:Exclude<keyof DiscountFields,'firstTime'|'active'>,type='text',required=false){return <Input label={labels(key)} value={fields[key]} onChange={value=>setFields(current=>({...current,[key]:value}))} type={type} required={required} disabled={busy} maxLength={255} min={type==='number'?0:undefined}/>;}
 async function submit(event?:FormEvent,resume=false){event?.preventDefault();if(!scope)return;setBusy(true);setError('');try{
  let input:unknown={productId:code.product_id,codeId:code.id};
  if(!resume){
   const values=discountFormInput('promotion_code',fields);if(!('code' in values))throw new Error('INVALID_INPUT');
   const {code:unused,...promotion}=values;void unused;
   const operationId=await discountOperationKey(sessionStorage,{action:'inventoryExport',scope,productId:code.product_id,codeId:code.id});setOperation(operationId);
   input={productId:code.product_id,codeId:code.id,operationId,promotion};
  }
  const response=await fetch('/api/admin/stripe-discounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:resume?'resumeExport':'exportPromotion',expectedScope:scope,input})});
  const data=await response.json() as {error?:string;operationId:string;sourceId:string;linked:boolean};if(!response.ok)throw new Error(data.error);
  setOperation(data.operationId);setResult({sourceId:data.sourceId,linked:data.linked});onUpdated();
 }catch(e){failed(e);}finally{setBusy(false);}}
 return <section className="rounded-xl border border-border p-6 space-y-5"><div className="flex items-center justify-between gap-4"><h2>{t('title')}</h2><Button variant="ghost" disabled={busy} onClick={onClose}>{t('close')}</Button></div><p className="break-all">{t('code',{id:code.id,batch:code.batch_name})}</p><p className="text-sm text-muted-foreground">{t('description')}</p><Button variant="outline" disabled={busy} onClick={()=>void connect()}>{t(scope?'reconnect':'connect')}</Button>{scope&&<><p>{t(scope.livemode?'live':'test',{account:scope.accountId})}</p>{!resumeOnly&&<form className="space-y-5" onSubmit={event=>void submit(event)}><div className="grid gap-5 md:grid-cols-2">{field('couponId','text',true)}{field('customerId')}{field('customerAccount')}{field('maxRedemptions','number')}{field('minimum','number')}{fields.minimum&&field('minimumCurrency','text',true)}{field('expires','datetime-local')}<Checkbox label={labels('firstTime')} checked={fields.firstTime} onCheckedChange={value=>setFields(current=>({...current,firstTime:value}))} disabled={busy}/></div><p className="text-sm text-muted-foreground">{labels('units')}</p><Button type="submit" disabled={busy}>{t(busy?'working':'push')}</Button></form>}{operation&&<Button variant="outline" disabled={busy} onClick={()=>void submit(undefined,true)}>{t('resume')}</Button>}</>}{operation&&<p className="break-all text-xs">{t('operation',{id:operation})}</p>}{result&&<Notice variant="default">{t(result.linked?'linked':'pending',{id:result.sourceId})}</Notice>}{error&&<Notice variant="destructive">{error}</Notice>}<Link className="inline-block underline" href="/dashboard/stripe-discounts">{t('reviewLink')}</Link></section>;
}
