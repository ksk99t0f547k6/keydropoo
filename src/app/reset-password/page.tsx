import { PoweredBy } from "@/components/site/powered-by";
import { BrandWordmark } from "@/components/site/brand-logo";
import type {Metadata} from 'next';
import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {runtime} from '@/lib/server/env';
import {ResetPasswordForm} from '@/components/auth/reset-password-form';
import {AuthFlowLink} from '@/components/auth/auth-flow-link';
export const dynamic='force-dynamic';
export const metadata:Metadata={robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function ResetPassword(){
 const {env,settings}=await runtime(),t=await getTranslations();
 return <main className="auth-shell"><Link className="wordmark" href="/"><BrandWordmark label={t('common.brand')}/></Link><section className="auth-card"><h1>{t('security.resetTitle')}</h1><p className="intro">{t('security.resetDescription')}</p>{env.EMAIL&&settings.EMAIL_FROM?<ResetPasswordForm/>:<p>{t('security.emailUnavailable')}</p>}<p className="mt-6"><AuthFlowLink page="sign-in">{t('security.backToSignIn')}</AuthFlowLink></p></section><PoweredBy/></main>;
}
