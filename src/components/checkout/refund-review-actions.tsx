'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/motion/button/base';
import {Input} from '@/components/motion/input';

type Decision='retain'|'revoke'|'acknowledge';
export function RefundReviewActions({id,refundedMinor,external,revoked}:{id:string;refundedMinor:number;external:boolean;revoked:boolean}){
 const t=useTranslations('refundReview'),router=useRouter();
 const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [request,setRequest]=useState<{decision:Decision;note:string;idempotencyKey:string}|null>(null);
 const [attempted,setAttempted]=useState(false);
 function choose(decision:Decision){setError('');setRequest({decision,note:note.trim(),idempotencyKey:crypto.randomUUID()});setAttempted(false);}
 async function submit(){
  if(!request)return;setBusy(true);setAttempted(true);setError('');
  try{
   const response=await fetch(`/api/admin/orders/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'review-refund',refundedMinor,...request})});
   if(!response.ok){setError(t(response.status===409?'conflict':'failed'));return;}
   router.refresh();
  }catch{setError(t('failed'));}finally{setBusy(false);}
 }
 return <section className="space-y-4 rounded-xl border border-border p-5" aria-label={t('title')}><h3 className="font-semibold">{t('title')}</h3><p className="text-sm text-muted-foreground">{t(external?'externalHint':revoked?'revokedHint':'hint')}</p>
 {!request?<><Input label={t('note')} value={note} onChange={setNote} maxLength={2000}/><div className="flex flex-wrap gap-3">{external||revoked?<Button disabled={note.trim().length<10} onClick={()=>choose('acknowledge')}>{t('acknowledge')}</Button>:<><Button variant="outline" disabled={note.trim().length<10} onClick={()=>choose('retain')}>{t('retain')}</Button><Button disabled={note.trim().length<10} onClick={()=>choose('revoke')}>{t('revoke')}</Button></>}</div></>:<><p>{t(`confirm.${request.decision}`)}</p><p className="break-words whitespace-pre-wrap text-sm">{request.note}</p><div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={()=>void submit()}>{t(busy?'saving':attempted?'retry':'confirmButton')}</Button>{!attempted&&<Button variant="ghost" disabled={busy} onClick={()=>setRequest(null)}>{t('cancel')}</Button>}</div></>}
 {error&&<div role="alert" className="space-y-3"><p className="text-sm">{error}</p><Button variant="outline" disabled={busy} onClick={()=>router.refresh()}>{t('refresh')}</Button></div>}</section>;
}
