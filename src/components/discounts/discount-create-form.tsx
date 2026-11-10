'use client';
import {useState,type FormEvent} from 'react';
import {useTranslations} from 'next-intl';
import {Input} from '@/components/motion/input';
import {Button} from '@/components/motion/button/base';
import {Checkbox} from '@/components/motion/checkbox';
import {Choice} from '@/components/inventory/choice';
import {discountFormInput,discountOperationKey,forgetDiscountOperation,emptyDiscountFields,type DiscountFields} from '@/lib/domain/stripe-discount-form';
import type {StripeDiscountScope} from '@/lib/server/stripe-discount-service';
import {Notice} from '@/components/dashboard/notice';
export function DiscountCreateForm({scope,kind,disabled,onBusy}:{scope:StripeDiscountScope;kind:'coupon'|'promotion_code';disabled:boolean;onBusy:(busy:boolean)=>void}){
 const t=useTranslations('stripeDiscountCreate'),[fields,setFields]=useState({...emptyDiscountFields}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<{sourceId:string;synced:boolean}|null>(null),[operation,setOperation]=useState('');
 const locked=busy||disabled;
 function change<K extends keyof DiscountFields>(key:K,value:DiscountFields[K]){setFields(current=>({...current,[key]:value}));setResult(null);setError('');setOperation('');}
 function field(key:Exclude<keyof DiscountFields,'firstTime'|'active'>,type='text',required=false){return <Input label={t(key)} value={fields[key]} onChange={value=>change(key,value)} type={type} required={required} disabled={locked} maxLength={key==='name'?40:key==='code'?500:2000} min={type==='number'?0:undefined} step={type==='number'?'any':undefined}/>;}
 async function newCreation(){try{await forgetDiscountOperation(sessionStorage,{action:kind==='coupon'?'createCoupon':'createPromotion',expectedScope:scope,input:discountFormInput(kind,fields)});setResult(null);setOperation('');setError('');}catch{setError(t('failed'));}}
 async function submit(event:FormEvent){event.preventDefault();setBusy(true);onBusy(true);setError('');setResult(null);try{
  const request={action:kind==='coupon'?'createCoupon':'createPromotion',expectedScope:scope,input:discountFormInput(kind,fields)};
  const operationId=await discountOperationKey(sessionStorage,request);setOperation(operationId);
  const response=await fetch('/api/admin/stripe-discounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,operationId})});
  const data=await response.json() as {error?:string;sourceId:string;synced:boolean};
  if(!response.ok)throw new Error(data.error);setResult({sourceId:data.sourceId,synced:data.synced});
 }catch(e){const code=e instanceof Error?e.message:'';setError(t(code==='INVALID_INPUT'?'invalid':code==='STRIPE_OPERATION_REVIEW_REQUIRED'?'review':code==='STRIPE_CONNECTION_CHANGED'?'changed':'failed'));}finally{setBusy(false);onBusy(false);}}
 return <details className="rounded-xl border border-border p-5"><summary className="cursor-pointer font-medium">{t(kind==='coupon'?'couponTitle':'promotionTitle')}</summary><form onSubmit={submit} className="mt-5 space-y-5"><p>{t(scope.livemode?'liveNotice':'testNotice')}</p><div className="grid gap-5 md:grid-cols-2">{kind==='coupon'?<>{field('name')}<Choice label={t('discountKind')} value={fields.discountKind} disabled={locked} onChange={value=>change('discountKind',value)} options={[{value:'percent',label:t('percentKind')},{value:'amount',label:t('amountKind')}]}/>{fields.discountKind==='percent'?field('percent','number',true):<>{field('amount','number',true)}{field('currency','text',true)}{field('currencyOptions')}</>}<Choice label={t('duration')} value={fields.duration} disabled={locked} onChange={value=>change('duration',value)} options={['once','forever','repeating'].map(value=>({value,label:t(value)}))}/>{fields.duration==='repeating'&&field('months','number',true)}{field('products')}</>:<>{field('couponId','text',true)}{field('code','text',true)}{field('customerId')}{field('customerAccount')}{field('minimum','number')}{fields.minimum&&field('minimumCurrency','text',true)}<Checkbox label={t('firstTime')} checked={fields.firstTime} onCheckedChange={value=>change('firstTime',value)} disabled={locked}/><Checkbox label={t('active')} checked={fields.active} onCheckedChange={value=>change('active',value)} disabled={locked}/></>}{field('maxRedemptions','number')}{field('expires','datetime-local')}</div><p className="text-sm text-muted-foreground">{t('units')}</p><Button type="submit" disabled={locked}>{t(busy?'working':result?'recheck':'create')}</Button>{result&&<Button type="button" variant="outline" disabled={locked} onClick={()=>void newCreation()}>{t("newCreation")}</Button>}{operation&&<p className="break-all text-xs">{t('operation',{id:operation})}</p>}{result&&<Notice variant="default">{t(result.synced?'created':'createdSyncPending',{id:result.sourceId})}</Notice>}{error&&<Notice variant="destructive">{error}</Notice>}</form></details>;
}
