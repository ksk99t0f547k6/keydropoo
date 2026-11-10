import { PoweredBy } from "@/components/site/powered-by";
import { BrandWordmark } from "@/components/site/brand-logo";
import type {Metadata} from 'next';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {runtime} from '@/lib/server/env';
import {createAuth} from '@/lib/server/auth';
import {SecurityPanel} from '@/components/account/security-panel';
import {readSecurityState} from '@/lib/server/password-settings';
import {SignOut} from '@/components/auth/sign-out';
import {signInLink} from '@/lib/domain/auth-navigation';

export const dynamic='force-dynamic';
export const metadata:Metadata={robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function Security(){
 const {env,settings}=await runtime();
 const session=await createAuth(env,settings).api.getSession({headers:await headers(),query:{disableCookieCache:true}});
 if(!session)redirect(signInLink('/account/security'));
 const t=await getTranslations();
 return <main><header className="site-header"><Link className="wordmark" href="/"><BrandWordmark label={t('common.brand')}/></Link><SignOut/></header><section className="dashboard-content max-w-xl"><h1>{t('security.title')}</h1><p className="intro">{t('security.description')}</p>
 <SecurityPanel state={await readSecurityState(env.DB,session.user,session.session.createdAt,Boolean(env.EMAIL&&settings.EMAIL_FROM))} returnTo="/account/security"/>
 <nav className="mt-8"><Link className="underline" href="/dashboard">{t('common.dashboard')}</Link></nav></section><PoweredBy/></main>;
}
