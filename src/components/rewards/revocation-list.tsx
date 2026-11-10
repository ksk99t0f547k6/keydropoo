'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/motion/button/base';
import {Table} from '@/components/motion/table';
import type {listExternalRevocations} from '@/lib/server/external-revocations';
import {Notice} from '@/components/dashboard/notice';
export function RevocationList({items}:{items:Awaited<ReturnType<typeof listExternalRevocations>>['items']}){
 const t=useTranslations('externalRevocations'),router=useRouter();const[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function retry(redemptionId:string){setBusy(true);setError('');try{
  const response=await fetch('/api/admin/external-revocations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redemptionId})});
  if(!response.ok)throw new Error();router.refresh();
 }catch{setError(t('retryFailed'));}finally{setBusy(false);}}
 return <div className="space-y-5"><Button variant="outline" disabled={busy} onClick={()=>router.refresh()}>{t('refresh')}</Button>{items.length?<Table data={items} getRowId={row=>row.redemption_id} height={480} columns={[
  {key:'product_name',header:t('product')},
  {key:'user_id',header:t('user')},
  {key:'redemption_id',header:t('source'),cell:row=><code className="break-all text-xs">{row.redemption_id}</code>},
  {key:'status',header:t('status'),cell:row=>t(row.status)},
  {key:'total_attempts',header:t('attempts'),width:'100px'},
  {key:'operation_id',header:t('action'),cell:row=><Button variant="outline" disabled={busy||row.status!=='failed'} onClick={()=>void retry(row.redemption_id)}>{t('retry')}</Button>},
 ]}/>:<p>{t('empty')}</p>}{error&&<Notice variant="destructive">{error}</Notice>}</div>;
}
