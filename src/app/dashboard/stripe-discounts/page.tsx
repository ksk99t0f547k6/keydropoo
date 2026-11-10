import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {runtime} from '@/lib/server/env';
import {createAuth,isAdmin} from '@/lib/server/auth';
import {DiscountManager} from '@/components/discounts/discount-manager';
import {PageHeader} from '@/components/dashboard/page-header';
import {Card,CardContent} from '@/components/motion/card';

export const dynamic='force-dynamic';
export default async function StripeDiscounts(){
 const {env,settings}=await runtime();const session=await createAuth(env,settings).api.getSession({headers:await headers()});
 if(!session)redirect('/sign-in');if(!await isAdmin(env.DB,session.user.id))redirect('/');
 const t=await getTranslations();
 return <><PageHeader crumbs={[{label:t('stripeDiscounts.title')}]} title={t('stripeDiscounts.title')} description={t('stripeDiscounts.description')}/><Card><CardContent><DiscountManager configured={Boolean(env.STRIPE_SECRET_KEY&&env.CODE_ENCRYPTION_KEY)}/></CardContent></Card></>;
}
