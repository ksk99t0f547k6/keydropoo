'use client';
import {useState,type FormEvent} from 'react';
import {useTranslations} from 'next-intl';
import {AuthFlowLink} from './auth-flow-link';
import {Button} from '@/components/motion/button/base';
import {Input} from '@/components/motion/input';

export function ResetPasswordForm(){
 const t=useTranslations('security');
 const [email,setEmail]=useState(''),[otp,setOtp]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
 const [sent,setSent]=useState(false),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(event:FormEvent){
  event.preventDefault();setError('');
  if(sent&&password!==confirmation){setError(t('mismatch'));return;}
  setBusy(true);
  try{
   const response=await fetch(sent?'/api/auth/email-otp/reset-password':'/api/auth/email-otp/request-password-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sent?{email,otp,password}:{email})});
   if(!response.ok){setError(t(response.status===429?'rateLimited':'resetFailed'));return;}
   if(sent){setOtp('');setPassword('');setConfirmation('');setSaved(true);}else setSent(true);
  }catch{setError(t('resetFailed'));}finally{setBusy(false);}
 }
 if(saved)return <div className="space-y-5"><p role="status">{t('resetSuccess')}</p><AuthFlowLink page="sign-in" reload>{t('signInAgain')}</AuthFlowLink></div>;
 return <form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="space-y-5">
 <Input label={t('email')} type="email" value={email} onChange={setEmail} required maxLength={254} autoComplete="email" disabled={sent}/>
 {sent&&<><p role="status" className="text-sm text-muted-foreground">{t('resetSent')}</p><Input label={t('code')} value={otp} onChange={setOtp} required inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} pattern="[0-9]{6}"/><Input label={t('newPassword')} type="password" value={password} onChange={setPassword} required minLength={12} maxLength={128} autoComplete="new-password"/><Input label={t('confirmPassword')} type="password" value={confirmation} onChange={setConfirmation} required minLength={12} maxLength={128} autoComplete="new-password"/><p className="text-sm text-muted-foreground">{t('resetHint')}</p></>}
 <Button type="submit" className="w-full" disabled={busy}>{t(busy?'working':sent?'reset':'sendReset')}</Button>
 {sent&&<Button type="button" variant="ghost" className="w-full" onClick={()=>{setSent(false);setOtp('');setPassword('');setConfirmation('');setError('');}}>{t('startAgain')}</Button>}
 </fieldset>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}</form>;
}
