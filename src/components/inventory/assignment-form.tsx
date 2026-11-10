'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {useTranslations} from 'next-intl';
import {Input} from '@/components/motion/input';
import {Button} from '@/components/motion/button/base';
import {Table} from '@/components/motion/table';
import type {CodeRow} from '@/lib/server/inventory';
import type {listAssignments} from '@/lib/server/assignments';
import {Notice} from '@/components/dashboard/notice';

export function AssignmentForm({code,onAssigned,onClose,emailDelivery=false}:{code:CodeRow;onAssigned:()=>void;onClose:()=>void;emailDelivery?:boolean}){
 const t=useTranslations('assignment');
 const [email,setEmail]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 const [pending,setPending]=useState<{body:string;key:string}|null>(null);
 async function submit(event:FormEvent){
  event.preventDefault();setBusy(true);setError('');
  try{
   let request=pending;
   if(!request){
    const input={productId:code.product_id,codeId:code.id,email:email.trim().toLowerCase(),note:note.trim()};
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
    const storageKey=`keydrop-assignment:${emailDelivery?'email':'account'}:${Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')}`;
    let key=crypto.randomUUID() as string;
    try{const old=sessionStorage.getItem(storageKey);if(old&&/^[a-f0-9-]{36}$/.test(old))key=old;else sessionStorage.setItem(storageKey,key);}catch{}
    request={body:JSON.stringify({...input,idempotencyKey:key}),key};setPending(request);
   }
   const response=await fetch(emailDelivery?'/api/email-distributions':'/api/assignments',{method:'POST',headers:{'Content-Type':'application/json'},body:request.body});
   const data=await response.json() as {id?:string;error?:string};
   if(!response.ok){
    if([400,401,403,404,409].includes(response.status))setPending(null);
    setError(t(data.error==='EMAIL_NOT_CONFIGURED'?'mailDisabled':data.error==='ASSIGNMENT_USER_NOT_FOUND'?'userMissing':data.error==='ASSIGNMENT_UNAVAILABLE'?'unavailable':data.error==='ASSIGNMENT_CONFLICT'?'conflict':'failed'));return;
   }
   setSaved(data.id!);onAssigned();
  }catch{setError(t('failed'));}finally{setBusy(false);}
 }
 return <section className="space-y-4 rounded-xl border border-border p-6"><div className="flex items-center justify-between gap-4"><h2>{t(emailDelivery?'emailTitle':'title')}</h2><Button variant="ghost" disabled={busy} onClick={onClose}>{t('close')}</Button></div><p className="text-sm text-muted-foreground">{t(emailDelivery?'emailDescription':'description')}</p><p className="break-all text-xs">{t('code',{id:code.id})}</p>
 {saved?<p role="status">{t(emailDelivery?'emailQueued':'saved',{id:saved})}</p>:<form onSubmit={submit} className="space-y-4"><fieldset disabled={busy||!!pending} className="grid gap-4 sm:grid-cols-2"><Input label={t(emailDelivery?'recipientEmail':'email')} type="email" value={email} onChange={setEmail} required/><Input label={t('note')} value={note} onChange={setNote} maxLength={1000} required/></fieldset><Button type="submit" disabled={busy}>{t(busy?'working':pending?'retry':emailDelivery?'emailSubmit':'submit')}</Button></form>}
 {pending&&<p className="break-all text-xs">{t('operation',{id:pending.key})}</p>}{error&&<Notice variant="destructive">{error}</Notice>}</section>;
}

export function AssignmentHistory({productId,revision}:{productId:string;revision:number}){
 const t=useTranslations('assignment');const [page,setPage]=useState(1),[data,setData]=useState<Awaited<ReturnType<typeof listAssignments>>|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- 啟動可取消的遠端載入時重設狀態；依賴固定且會清理舊請求。
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError(false);
  fetch(`/api/assignments?productId=${productId}&page=${page}`,{signal:abort.signal}).then(async response=>{if(!response.ok)throw new Error();const next=await response.json() as Awaited<ReturnType<typeof listAssignments>>;if(!abort.signal.aborted)setData(next);}).catch(()=>{if(!abort.signal.aborted){setError(true);setData(null);}}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>abort.abort();
 },[productId,page,revision]);
 return <section className="space-y-4"><h2>{t('history')}</h2>{error&&<Notice variant="destructive">{t('failed')}</Notice>}<Table data={data?.items??[]} getRowId={row=>row.id} loading={loading} height={260} emptyState={<p className="p-6">{t('empty')}</p>} columns={[{key:'email',header:t('email')},{key:'code_id',header:t('codeColumn'),cell:row=><span className="text-xs font-mono">{row.code_id.slice(0,8)}</span>},{key:'note',header:t('note')},{key:'created_at',header:t('created'),cell:row=>new Date(row.created_at).toLocaleString('en')} ]}/><div className="flex gap-3"><Button variant="outline" disabled={loading||page===1} onClick={()=>setPage(p=>p-1)}>{t('previous')}</Button><Button variant="outline" disabled={loading||!data?.hasMore} onClick={()=>setPage(p=>p+1)}>{t('next')}</Button></div></section>;
}
