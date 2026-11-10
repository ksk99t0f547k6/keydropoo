'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/motion/button/base';
import {Input} from '@/components/motion/input';
import type {ExternalReviewRow} from '@/lib/server/external-reviews';
import {Notice} from '@/components/dashboard/notice';
export function ReviewList({items}:{items:ExternalReviewRow[]}){
 const t=useTranslations('externalReviews'),router=useRouter();const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notes,setNotes]=useState<Record<string,string>>({});
 async function resolve(attemptId:string,outcome:'applied'|'not_applied'){
  setBusy(true);setError('');try{
   const response=await fetch('/api/admin/external-reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attemptId,outcome,note:notes[attemptId]??''})});
   if(!response.ok)throw new Error();router.refresh();
  }catch{setError(t('failed'));}finally{setBusy(false);}
 }
 return <div className="space-y-5"><Button variant="outline" disabled={busy} onClick={()=>router.refresh()}>{t('refresh')}</Button>{items.length?items.map(item=><section key={item.id} className="space-y-4 rounded-xl border border-border p-5"><h2>{item.product_name}</h2><p className="break-all text-sm">{t('operation',{id:item.id})}</p><p className="break-all text-sm">{t('user',{id:item.user_id})}</p><Input label={t('note')} value={notes[item.id]??''} onChange={value=>setNotes(current=>({...current,[item.id]:value}))} disabled={busy} maxLength={2000}/><div className="flex flex-wrap gap-4"><Button disabled={busy||(notes[item.id]?.trim().length??0)<10} onClick={()=>void resolve(item.id,'applied')}>{t('applied')}</Button><Button variant="outline" disabled={busy||(notes[item.id]?.trim().length??0)<10} onClick={()=>void resolve(item.id,'not_applied')}>{t('notApplied')}</Button></div></section>):<p>{t('empty')}</p>}{error&&<Notice variant="destructive">{error}</Notice>}</div>;
}
