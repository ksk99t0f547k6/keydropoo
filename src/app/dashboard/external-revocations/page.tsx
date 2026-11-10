import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {runtime} from '@/lib/server/env';
import {createAuth,isAdmin} from '@/lib/server/auth';
import {listExternalRevocations} from '@/lib/server/external-revocations';
import {RevocationList} from '@/components/rewards/revocation-list';
import {PageHeader} from '@/components/dashboard/page-header';
import {PrevNext} from '@/components/dashboard/page-pagination';

export const dynamic='force-dynamic';
export default async function ExternalRevocations({searchParams}:{searchParams:Promise<{page?:string}>}){
 const {env,settings}=await runtime();const session=await createAuth(env,settings).api.getSession({headers:await headers()});
 if(!session)redirect('/sign-in');if(!await isAdmin(env.DB,session.user.id))redirect('/');
 const raw=(await searchParams).page;const page=raw&&/^\d+$/.test(raw)?Math.min(100000,Math.max(1,Number(raw))):1;
 const t=await getTranslations(),list=await listExternalRevocations(env.DB,page);
 return <><PageHeader crumbs={[{label:t('externalRevocations.title')}]} title={t('externalRevocations.title')} description={t('externalRevocations.description')}/><RevocationList items={list.items}/><PrevNext page={page} hasMore={list.hasMore}/></>;
}
