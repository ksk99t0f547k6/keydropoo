'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/motion/button/base';
export function LinkEmailDistributions({verified}:{verified:boolean}){
 const t=useTranslations('emailLink'),router=useRouter();
 const [busy,setBusy]=useState(false),[result,setResult]=useState<number|null>(null),[error,setError]=useState(false);
 async function link(){setBusy(true);setError(false);try{
  const response=await fetch('/api/email-distributions/link',{method:'POST'});if(!response.ok)throw new Error();
  const data=await response.json() as {linked:number};setResult(data.linked);router.refresh();
 }catch{setError(true);}finally{setBusy(false);}}
 return <section className="mb-6 space-y-3 rounded-xl border border-border p-4"><p className="text-sm">{t(verified?'hint':'verify')}</p><Button variant="outline" disabled={busy||!verified} onClick={link}>{t(busy?'working':'submit')}</Button>{result!==null&&<p role="status">{t('result',{count:result})}</p>}{error&&<p role="alert">{t('failed')}</p>}</section>;
}
