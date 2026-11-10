'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {useTranslations,useFormatter} from 'next-intl';
import {Table} from '@/components/motion/table';
import {Input} from '@/components/motion/input';
import {Button} from '@/components/motion/button/base';
import type {listProductDevices} from '@/lib/server/licenses';
import {Notice} from '@/components/dashboard/notice';

type Devices=Awaited<ReturnType<typeof listProductDevices>>;
export function ProductDevices({productId}:{productId:string}){
 const t=useTranslations('adminDevices'),format=useFormatter();
 const [page,setPage]=useState(1),[filter,setFilter]=useState(''),[codeId,setCodeId]=useState(''),[revision,setRevision]=useState(0);
 const [data,setData]=useState<Devices|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [selected,setSelected]=useState<Devices['devices'][number]|null>(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{
 // eslint-disable-next-line react-hooks/set-state-in-effect -- 啟動可取消的遠端載入時重設狀態；依賴固定且會清理舊請求。
  const abort=new AbortController();setLoading(true);setError('');setData(null);
  const query=new URLSearchParams({productId,page:String(page),...(codeId?{codeId}:{})});
  fetch(`/api/admin/license-devices?${query}`,{signal:abort.signal}).then(async response=>{
   if(!response.ok)throw new Error();const result=await response.json() as Devices;
   if(!abort.signal.aborted)setData(result);
  }).catch(()=>{if(!abort.signal.aborted)setError(t('loadFailed'));}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>abort.abort();
 },[productId,page,codeId,revision,t]);
 function search(event:FormEvent){
  event.preventDefault();const value=filter.trim();
  if(value&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)){setError(t('invalidCode'));return;}
  setSelected(null);setSaved(false);setCodeId(value);setPage(1);setRevision(n=>n+1);
 }
 async function release(){
  if(!selected)return;setBusy(true);setError('');setSaved(false);
  try{
   const response=await fetch('/api/admin/license-devices',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId,activationId:selected.id})});
   if(!response.ok)throw new Error();
   setSaved(true);setSelected(null);setRevision(n=>n+1);
  }catch{setError(t('releaseFailed'));}finally{setBusy(false);}
 }
 return <div className="space-y-6">
 <form onSubmit={search} className="flex flex-wrap items-end gap-3"><div className="min-w-64 flex-1"><Input label={t('filter')} value={filter} onChange={setFilter} disabled={busy}/></div><Button type="submit" disabled={busy||loading}>{t('apply')}</Button><Button variant="ghost" type="button" disabled={busy||loading} onClick={()=>{setFilter('');setCodeId('');setPage(1);setSelected(null);setRevision(n=>n+1);}}>{t('clear')}</Button></form>
 <div className="hidden lg:block"><Table data={data?.devices??[]} getRowId={row=>row.id} height={360} rowHeight={110} loading={loading} emptyState={<p className="p-6">{t('empty')}</p>} columns={[
 {key:'label',header:t('device'),width:'250px',cell:row=><div><p>{row.label||t('unnamed')}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{row.id}</p><p className="mt-1 text-xs text-muted-foreground">{format.dateTime(row.activated_at,{dateStyle:'medium',timeStyle:'short'})}</p></div>},
 {key:'code_id',header:t('codeOwner'),width:'270px',cell:row=><div><p className="break-all font-mono text-xs">{row.code_id}</p><p className="mt-2 break-all text-xs text-muted-foreground">{row.user_id?t('account',{id:row.user_id}):t('unique')}</p></div>},
 {key:'code_status',header:t('status'),width:'160px',cell:row=><div><p>{t(row.released_at===null?'bound':'released')}</p><p className="text-xs text-muted-foreground">{t(`codeStates.${row.code_status}`)}</p></div>},
 {key:'id',header:t('action'),width:'160px',cell:row=><Button variant="outline" disabled={busy||row.released_at!==null} onClick={()=>{setSelected(row);setSaved(false);setError('');}}>{t('release')}</Button>}
 ]}/></div>
 <div className="space-y-4 lg:hidden">{loading?<p role="status">{t('loading')}</p>:!data?.devices.length?<p>{t('empty')}</p>:data.devices.map(row=><article key={row.id} className="space-y-4 rounded-xl border border-border p-5"><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-base font-semibold">{row.label||t('unnamed')}</h2><div className="text-right"><p>{t(row.released_at===null?'bound':'released')}</p><p className="text-xs text-muted-foreground">{t(`codeStates.${row.code_status}`)}</p></div></div><dl className="space-y-3 text-sm"><div><dt className="text-muted-foreground">{t('activationId')}</dt><dd className="break-all font-mono text-xs">{row.id}</dd></div><div><dt className="text-muted-foreground">{t('code')}</dt><dd className="break-all font-mono text-xs">{row.code_id}</dd></div><div><dt className="text-muted-foreground">{t('owner')}</dt><dd className="break-all">{row.user_id||t('unique')}</dd></div><div><dt className="text-muted-foreground">{t('activated')}</dt><dd>{format.dateTime(row.activated_at,{dateStyle:'medium',timeStyle:'short'})}</dd></div></dl><Button variant="outline" disabled={busy||row.released_at!==null} onClick={()=>{setSelected(row);setSaved(false);setError('');}}>{t('release')}</Button></article>)}</div>
 {selected&&<section className="space-y-4 rounded-xl border border-border p-5" aria-label={t('confirmTitle')}><h2>{t('confirmTitle')}</h2><p>{t('confirmDescription',{device:selected.label||t('unnamed')})}</p><p className="break-all font-mono text-xs">{selected.id}</p><div className="flex gap-3"><Button disabled={busy} onClick={()=>void release()}>{t(busy?'working':'confirm')}</Button><Button variant="ghost" disabled={busy} onClick={()=>{setSelected(null);setError('');}}>{t('cancel')}</Button></div></section>}
 {saved&&<Notice variant="success">{t('success')}</Notice>}{error&&<Notice variant="destructive">{error}</Notice>}
 <nav className="flex flex-wrap items-center gap-3" aria-label={t('pagination')}><Button variant="outline" disabled={busy||loading||page===1} onClick={()=>{setSelected(null);setPage(n=>n-1);}}>{t('previous')}</Button><span>{t('page',{page})}</span><Button variant="outline" disabled={busy||loading||!data?.hasMore} onClick={()=>{setSelected(null);setPage(n=>n+1);}}>{t('next')}</Button><Button variant="ghost" disabled={busy||loading} onClick={()=>{setSelected(null);setRevision(n=>n+1);}}>{t('refresh')}</Button></nav>
 </div>;
}
