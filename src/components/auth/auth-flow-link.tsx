'use client';
import {useSyncExternalStore,type ReactNode} from 'react';
import Link from 'next/link';
import {returnFromHash} from '@/lib/domain/auth-navigation';

function subscribe(notify:()=>void){window.addEventListener('hashchange',notify);return()=>window.removeEventListener('hashchange',notify);}
function snapshot(){return window.location.hash;}
function serverSnapshot(){return '';}
export function AuthFlowLink({page,children,reload=false}:{page:'sign-in'|'reset-password';children:ReactNode;reload?:boolean}){
 const hash=useSyncExternalStore(subscribe,snapshot,serverSnapshot);
 const href=`/${page}${hash?'#'+new URLSearchParams({returnTo:returnFromHash(hash)}):''}`;
 // 私密活動資訊仍只在 fragment；重設完成後完整導覽，清除舊登入頁面快取。
 return reload?<a className="underline" href={href}>{children}</a>:<Link className="underline" href={href}>{children}</Link>;
}
