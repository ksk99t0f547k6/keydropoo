'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {useTranslations} from 'next-intl';
import {Table} from '@/components/motion/table';
import {Input} from '@/components/motion/input';
import {Button} from '@/components/motion/button/base';
import type {listEmailDistributions} from '@/lib/server/email-distributions';
import {Notice} from '@/components/dashboard/notice';
type History=Awaited<ReturnType<typeof listEmailDistributions>>&{enabled:boolean};
export function EmailDistributionHistory({productId,revision}:{productId:string;revision:number}){
 const t=useTranslations('emailDistribution');
 const [page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[data,setData]=useState<History|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 const [pending,setPending]=useState<string|null>(null);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- 啟動可取消的遠端載入時重設狀態；依賴固定且會清理舊請求。
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');
 fetch(`/api/email-distributions?productId=${productId}&page=${page}`,{signal:abort.signal}).then(async response=>{if(!response.ok)throw new Error();const next=await response.json() as History;if(!abort.signal.aborted)setData(next);}).catch(()=>{if(!abort.signal.aborted){setData(null);setError(t('failed'));}}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();
 },[productId,page,revision,refresh,t]);
 async function retry(event:FormEvent){
  event.preventDefault();if(!selected)return;setBusy(true);setError('');setSaved(false);
  const body=pending??JSON.stringify({productId,id:selected,note,idempotencyKey:crypto.randomUUID()});setPending(body);
  try{const response=await fetch('/api/email-distributions',{method:'PATCH',headers:{'Content-Type':'application/json'},body});
   if(!response.ok){if([400,403,404,409].includes(response.status))setPending(null);throw new Error();}
   setSaved(true);setSelected(null);setNote('');setPending(null);setRefresh(value=>value+1);
  }catch{setError(t('failed'));}finally{setBusy(false);}
 }
 return <section className="space-y-4"><h2>{t('title')}</h2><p className="text-sm text-muted-foreground">{t('hint')}</p>{data&&!data.enabled&&<p>{t('disabled')}</p>}
 <Table data={data?.items??[]} getRowId={row=>row.id} height={280} loading={loading} emptyState={<p className="p-6">{t('empty')}</p>} columns={[
 {key:'email',header:t('email')},{key:'status',header:t('status'),cell:row=>t(`states.${row.status}`)},
 {key:'total_attempts',header:t('attempts')},{key:'retry_count',header:t('retries')},
 {key:'id',header:t('action'),cell:row=><Button variant="outline" disabled={busy||!!pending||!data?.enabled||row.status!=='failed'} onClick={()=>{setSelected(row.id);setNote('');setSaved(false);}}>{t('retry')}</Button>}
 ]}/>
 {selected&&<form onSubmit={retry} className="space-y-3"><p className="break-all text-xs">{t('job',{id:selected})}</p><Input label={t('note')} value={note} onChange={setNote} minLength={10} maxLength={1000} required disabled={busy||!!pending}/><Button type="submit" disabled={busy}>{t(busy?'working':'retry')}</Button></form>}
 {saved&&<Notice variant="success">{t('queued')}</Notice>}{error&&<Notice variant="destructive">{error}</Notice>}
 <div className="flex gap-3"><Button variant="outline" disabled={loading||page===1} onClick={()=>setPage(value=>value-1)}>{t('previous')}</Button><Button variant="outline" disabled={loading||!data?.hasMore} onClick={()=>setPage(value=>value+1)}>{t('next')}</Button><Button variant="ghost" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>{t('refresh')}</Button></div></section>;
}
