"use client";
import {useEffect,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {useTranslations,useFormatter} from "next-intl";
import {Button} from "@/components/motion/button/base";
import {Input} from "@/components/motion/input";
import {Checkbox} from "@/components/motion/checkbox";
import type {listWebhookEndpoints} from "@/lib/server/webhook-management";
import {Notice} from "@/components/dashboard/notice";
type Endpoint=Awaited<ReturnType<typeof listWebhookEndpoints>>[number];
type Delivery={id:string;event_id:string;type:string;status:string;attempts:number;total_attempts:number;retry_count:number;last_status:number|null;next_attempt_at:number;created_at:number};
const events=['code.assigned','code.claimed','code.redeemed','code.revoked','order.delivered','order.refunded'];
export function WebhookManager({endpoints,products,secretNames}:{endpoints:Endpoint[];products:{id:string;name:string}[];secretNames:string[]}){
 const t=useTranslations('webhooks'),format=useFormatter(),router=useRouter();
 const[name,setName]=useState(''),[url,setUrl]=useState(''),[secretName,setSecretName]=useState('');
 const[types,setTypes]=useState<string[]>([]),[productIds,setProductIds]=useState<string[]>([]),[all,setAll]=useState(false);
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[selected,setSelected]=useState<string|null>(null),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
 const[deliveries,setDeliveries]=useState<Delivery[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(false);
 const endpoint=endpoints.find(e=>e.id===selected);
 function message(code:string){return t(t.has(`errors.${code}`)?`errors.${code}`:'errors.generic');}
 async function mutate(method:string,body:unknown){
  const response=await fetch('/api/webhooks',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error??'generic');return data;
 }
 async function create(event:FormEvent){
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{await mutate('POST',{name,url,secretName,events:types,productIds:all?null:productIds});setName('');setUrl('');setNotice(t('created'));router.refresh();}
  catch(e){setError(message(e instanceof Error?e.message:'generic'));}finally{setBusy(false);}
 }
 async function change(body:unknown){
  setBusy(true);setError('');setNotice('');
  try{await mutate('PATCH',body);router.refresh();setRevision(r=>r+1);setNotice(t('updated'));}
  catch(e){setError(message(e instanceof Error?e.message:'generic'));}finally{setBusy(false);}
 }
 useEffect(()=>{
  if(!selected)return;
 // eslint-disable-next-line react-hooks/set-state-in-effect -- 啟動可取消的遠端載入時重設狀態；依賴固定且會清理舊請求。
  const controller=new AbortController();setLoading(true);setError('');setDeliveries([]);
  fetch(`/api/webhooks?endpointId=${selected}&page=${page}`,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error();const data=await response.json() as {deliveries:Delivery[];total:number};if(!controller.signal.aborted){setDeliveries(data.deliveries);setTotal(data.total);}
  }).catch(()=>{if(!controller.signal.aborted)setError(t('errors.generic'));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[selected,page,revision,t]);
 const date=(value:number)=>format.dateTime(value,{dateStyle:'medium',timeStyle:'short'});
 return <div className="space-y-8">
 <form onSubmit={create} className="rounded-xl border border-border p-6"><h2>{t('create')}</h2><p className="my-3 text-sm text-muted-foreground">{t('setupHint')}</p><fieldset disabled={busy} className="space-y-5">
 <div className="grid gap-4 sm:grid-cols-2"><Input label={t('name')} value={name} onChange={setName} maxLength={120} required/><Input label={t('url')} type="url" value={url} onChange={setUrl} maxLength={2048} required/><Input label={t('secretName')} value={secretName} onChange={setSecretName} maxLength={64} required/></div>
 <p className="text-sm text-muted-foreground">{t('secretHint')}</p><fieldset className="space-y-2"><legend>{t('events')}</legend>{events.map(value=><Checkbox key={value} label={value} checked={types.includes(value)} onCheckedChange={checked=>setTypes(previous=>checked?[...previous,value]:previous.filter(v=>v!==value))}/>)}</fieldset>
 <fieldset className="space-y-2"><legend>{t('products')}</legend><Checkbox label={t('allProducts')} checked={all} onCheckedChange={setAll}/>{!all&&products.map(product=><Checkbox key={product.id} label={product.name} checked={productIds.includes(product.id)} onCheckedChange={checked=>setProductIds(previous=>checked?[...previous,product.id]:previous.filter(id=>id!==product.id))}/>)}</fieldset>
 <Button type="submit" disabled={busy||!types.length||(!all&&!productIds.length)}>{t('create')}</Button></fieldset></form>
 {error&&<Notice variant="destructive">{error}</Notice>}{notice&&<Notice variant="success">{notice}</Notice>}
 <section className="space-y-4"><h2>{t('endpoints')}</h2>{!endpoints.length&&<p>{t('empty')}</p>}{endpoints.map(e=><article key={e.id} className="space-y-3 rounded-xl border border-border p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3>{e.name}</h3><span>{t(e.enabled?'enabled':'disabled')}</span></div><p className="break-all font-mono text-sm">{e.url}</p><p className="text-sm">{e.events.join(', ')}</p><p className="text-sm">{t('products')}: {e.productIds===null?t('allProducts'):e.productIds.map(id=>products.find(p=>p.id===id)?.name??id).join(', ')}</p><p className="text-sm">{t('secretName')}: {e.secret_name}</p>{!secretNames.includes(e.secret_name)&&<p className="text-sm text-muted-foreground">{t('missingSecret')}</p>}<div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy||(!e.enabled&&!secretNames.includes(e.secret_name))} onClick={()=>void change({action:'enabled',endpointId:e.id,enabled:!e.enabled})}>{t(e.enabled?'disable':'enable')}</Button><Button variant="ghost" onClick={()=>{setSelected(e.id);setPage(1);setRevision(r=>r+1);}}>{t('deliveries')}</Button></div></article>)}</section>
 {endpoint&&<section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2>{t('history',{name:endpoint.name})}</h2><Button variant="outline" disabled={loading} onClick={()=>setRevision(r=>r+1)}>{t('refresh')}</Button></div>{loading?<p>{t('loading')}</p>:!deliveries.length?<p>{t('noDeliveries')}</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['event','status','attempts','response','nextAttempt','action'].map(key=><th key={key} className="p-3">{t(key)}</th>)}</tr></thead><tbody>{deliveries.map(d=><tr key={d.id} className="border-t border-border"><td className="p-3"><p>{d.type}</p><p className="max-w-52 break-all font-mono text-xs">{d.event_id}</p><p>{date(d.created_at)}</p></td><td className="p-3">{t(`states.${d.status}`)}</td><td className="p-3">{d.total_attempts}<p>{t('retryCount',{count:d.retry_count})}</p></td><td className="p-3">{d.last_status??'—'}</td><td className="p-3">{d.status==='pending'?date(d.next_attempt_at):'—'}</td><td className="p-3">{d.status==='failed'&&<Button variant="outline" disabled={busy||!endpoint.enabled} onClick={()=>void change({action:'retry',endpointId:endpoint.id,deliveryId:d.id})}>{t('retry')}</Button>}</td></tr>)}</tbody></table></div>}<div className="flex gap-3"><Button variant="outline" disabled={loading||page===1} onClick={()=>setPage(v=>v-1)}>{t('previous')}</Button><span>{t('page',{page,pages:Math.max(1,Math.ceil(total/20))})}</span><Button variant="outline" disabled={loading||page*20>=total} onClick={()=>setPage(v=>v+1)}>{t('next')}</Button></div></section>}
 </div>;
}
