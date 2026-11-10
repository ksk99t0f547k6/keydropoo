"use client";
import {useRef,useState} from 'react';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/motion/button/base';
type Job={id:string;status:string};
export function CodeEmailButton({codeId,initialJob}:{codeId:string;initialJob?:Job}){
 const t=useTranslations('codeEmail'),requestKey=useRef<string|null>(null);
 const[job,setJob]=useState<Job|undefined>(initialJob),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=job?.status==='pending'||job?.status==='sending';
 async function send(){
  setBusy(true);setError('');requestKey.current??=crypto.randomUUID();
  try{
   const response=await fetch('/api/code-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codeId,idempotencyKey:requestKey.current})});
   const data=await response.json() as Job&{error?:string};if(!response.ok)throw new Error(data.error);
   setJob(data);requestKey.current=null;
  }catch(e){const code=e instanceof Error?e.message:'';setError(t(t.has(`errors.${code}`)?`errors.${code}`:'errors.generic'));}finally{setBusy(false);}
 }
 async function refresh(){
  if(!job)return;setBusy(true);setError('');
  try{const response=await fetch(`/api/code-email?id=${job.id}`);if(!response.ok)throw new Error();setJob(await response.json() as Job);}
  catch{setError(t('errors.generic'));}finally{setBusy(false);}
 }
 return <div className="space-y-2"><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy||pending} onClick={()=>void send()}>{t(job?'sendAgain':'send')}</Button>{job&&<Button variant="ghost" disabled={busy} onClick={()=>void refresh()}>{t('refresh')}</Button>}</div>{job&&<p role="status" className="text-sm text-muted-foreground">{t(`states.${job.status}`)}</p>}{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}</div>;
}
