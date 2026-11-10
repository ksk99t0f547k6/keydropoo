'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {Input} from '@/components/motion/input';
import {Button} from '@/components/motion/button/base';
import type {StripeDiscountScope} from '@/lib/server/stripe-discount-service';
import type {listStripeDiscountOperations} from '@/lib/server/stripe-discount-operations';
import {Notice} from '@/components/dashboard/notice';
type Item=Awaited<ReturnType<typeof listStripeDiscountOperations>>['items'][number];
export function DiscountOperationList({scope,busy,onBusy}:{scope:StripeDiscountScope;busy:boolean;onBusy:(busy:boolean)=>void}){
 const [observedAt,setObservedAt]=useState(0);
 const t=useTranslations('stripeDiscountOperations'),[items,setItems]=useState<Item[]>([]),[page,setPage]=useState(1),[more,setMore]=useState(false),[loaded,setLoaded]=useState(false),[ids,setIds]=useState<Record<string,string>>({}),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function api<T>(body:unknown){const response=await fetch('/api/admin/stripe-discounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json() as T & {error?:string};if(!response.ok)throw new Error(result.error);return result;}
 async function refresh(next=1){onBusy(true);setError('');try{const result=await api<{scope:StripeDiscountScope;items:Item[];hasMore:boolean}>({action:'operations',page:next});if(result.scope.accountId!==scope.accountId||result.scope.livemode!==scope.livemode)throw new Error('STRIPE_CONNECTION_CHANGED');setObservedAt(Date.now());setItems(result.items);setMore(result.hasMore);setPage(next);setLoaded(true);}catch{setError(t('failed'));}finally{onBusy(false);}}
 async function act(item:Item,action:'resume'|'recover'){onBusy(true);setError('');setNotice('');try{
  const sourceId=item.kind==='coupon'?`kd_${item.id.replaceAll('-','')}`:ids[item.id]?.trim();
  const result=await api<{sourceId:string;synced:boolean}>({action,operationId:item.id,expectedScope:scope,...(action==='recover'?{sourceId}:{})});
  setNotice(t(result.synced?'completed':'syncPending',{id:result.sourceId}));
  setItems(current=>current.map(value=>value.id===item.id?{...value,state:'applied',source_id:result.sourceId}:value));
 }catch(e){setError(t(e instanceof Error&&e.message==='STRIPE_OPERATION_REVIEW_REQUIRED'?'reviewRequired':'failed'));}finally{onBusy(false);}}
 return <details className="rounded-xl border border-border p-5"><summary className="cursor-pointer font-medium">{t('title')}</summary><div className="mt-5 space-y-5"><p>{t('description')}</p><Button variant="outline" disabled={busy} onClick={()=>void refresh()}>{t('refresh')}</Button>{loaded&&!items.length&&<p>{t('empty')}</p>}{items.map(item=>{
  const expired=item.first_attempt_at!==null&&observedAt-item.first_attempt_at>=23*3600000;
  return <section key={item.id} className="space-y-3 border-t border-border pt-4"><p className="break-all font-mono text-xs">{item.id}</p><p>{t('state',{state:t(item.state==='applied'?'applied':expired?'review':item.state)})}</p>{item.source_id&&<p className="break-all">{t('source',{id:item.source_id})}</p>}<Button disabled={busy||item.state==='review'||(expired&&item.state!=='applied')} variant="outline" onClick={()=>void act(item,'resume')}>{t(item.state==='applied'?'sync':'retry')}</Button>{item.state!=='applied'&&item.first_attempt_at!==null&&<div className="space-y-3">{item.kind==='promotion_code'&&<Input label={t('sourceId')} value={ids[item.id]??''} disabled={busy} onChange={value=>setIds(current=>({...current,[item.id]:value}))} maxLength={255}/>}<Button disabled={busy||(item.kind==='promotion_code'&&!ids[item.id]?.trim())} variant="outline" onClick={()=>void act(item,'recover')}>{t('recover')}</Button></div>}</section>;
 })}<div className="flex gap-4">{page>1&&<Button disabled={busy} onClick={()=>void refresh(page-1)}>{t('previous')}</Button>}{more&&<Button disabled={busy} onClick={()=>void refresh(page+1)}>{t('next')}</Button>}</div>{notice&&<Notice variant="success">{notice}</Notice>}{error&&<Notice variant="destructive">{error}</Notice>}</div></details>;
}
