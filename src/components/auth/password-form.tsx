'use client';
import {useState,type FormEvent} from 'react';
import {useTranslations} from 'next-intl';
import Link from 'next/link';
import {Button} from '@/components/motion/button/base';
import {Input} from '@/components/motion/input';
import {signInLink} from '@/lib/domain/auth-navigation';

// returnTo：完成或需重新登入後要回到的帳號頁（一般使用者 /account/security，管理員 /dashboard/security）。
export function PasswordForm({hasPassword,returnTo='/account/security'}:{hasPassword:boolean;returnTo?:string}){
 const t=useTranslations('security');
 const [currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[reauth,setReauth]=useState(false);
 async function submit(event:FormEvent){
  event.preventDefault();setError('');setReauth(false);
  if(newPassword!==confirmation){setError(t('mismatch'));return;}
  setBusy(true);
  try{
   const response=await fetch(hasPassword?'/api/auth/change-password':'/api/account/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(hasPassword?{currentPassword,newPassword,revokeOtherSessions:true}:{newPassword})});
   const data=await response.json() as {code?:string;error?:string};
   if(!response.ok){
    const code=data.code??data.error;
    if(response.status===401||code==='SESSION_NOT_FRESH'){setReauth(true);setError(t('reauth'));}
    else if(response.status===429)setError(t('rateLimited'));
    else if(code==='PASSWORD_ALREADY_SET')setError(t('alreadySet'));
    else if(code==='EMAIL_VERIFICATION_REQUIRED')setError(t('verifyFirst'));
    else setError(t('failed'));
    return;
   }
   setCurrentPassword('');setNewPassword('');setConfirmation('');setSaved(true);
  }catch{setError(t('failed'));}finally{setBusy(false);}
 }
 // 完整重載，避免首次設定後重用尚未有密碼時的路由快取。
 // 用一般連結整頁重載，清除憑證異動前的頁面快取。
 if(saved)return <div className="space-y-5"><p role="status">{t(hasPassword?'changed':'saved')}</p><a className="underline" href={returnTo}>{t('back')}</a></div>;
 return <form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="space-y-5">
 {hasPassword&&<Input label={t('currentPassword')} type="password" value={currentPassword} onChange={setCurrentPassword} required maxLength={128} autoComplete="current-password"/>}
 <Input label={t('newPassword')} type="password" value={newPassword} onChange={setNewPassword} required minLength={12} maxLength={128} autoComplete="new-password"/>
 <Input label={t('confirmPassword')} type="password" value={confirmation} onChange={setConfirmation} required minLength={12} maxLength={128} autoComplete="new-password"/>
 <p className="text-sm text-muted-foreground">{t(hasPassword?'changeHint':'setHint')}</p>
 <Button type="submit" className="w-full" disabled={busy}>{t(busy?'working':hasPassword?'change':'set')}</Button>
 </fieldset>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}{reauth&&<Link className="underline" href={signInLink(returnTo)}>{t('signInAgain')}</Link>}</form>;
}
