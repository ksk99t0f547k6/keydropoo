import Link from "next/link";
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {getTranslations,getFormatter} from 'next-intl/server';
import {runtime} from '@/lib/server/env';
import {createAuth,isAdmin} from '@/lib/server/auth';
import {listAdminNotifications,notificationKind} from '@/lib/server/admin-notifications';
import {PageHeader} from '@/components/dashboard/page-header';
import {LinkTabs} from '@/components/dashboard/link-tabs';
import {PrevNext} from '@/components/dashboard/page-pagination';
import {Notice} from '@/components/dashboard/notice';
import {Card,CardContent} from '@/components/motion/card';
import {AnimatedBadge} from '@/components/motion/animated-badge';
import {ArrowUpRight} from 'lucide-react';
import {siteFeatures} from '@/config/site';

export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function Notifications({searchParams}:{searchParams:Promise<{page?:string|string[];status?:string|string[]}>}){
 const {env,settings}=await runtime(),session=await createAuth(env,settings).api.getSession({headers:await headers()});
 if(!session)redirect('/sign-in');if(!await isAdmin(env.DB,session.user.id))redirect('/');
 const query=await searchParams,page=typeof query.page==='string'&&/^\d+$/.test(query.page)?Math.min(100000,Math.max(1,Number(query.page))):1,status=query.status==='resolved'?'resolved':'open';
 const list=await listAdminNotifications(env.DB,{page,status}),t=await getTranslations('notifications'),format=await getFormatter();
 const verified=await env.DB.prepare('SELECT emailVerified FROM "user" WHERE id=?').bind(session.user.id).first<{emailVerified:number}>();
 const emailEnabled=siteFeatures.adminNotificationEmail&&!!env.EMAIL&&!!env.EMAIL_FROM&&verified?.emailVerified===1;
 const tone={revocation:'warning',unknown:'warning',rejected:'danger'} as const;
 return <><PageHeader crumbs={[{label:t('title')}]} title={t('title')} description={t('description')}/>
 <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><LinkTabs label={t('filter')} value={status} items={[{value:'open',label:t('open'),href:'/dashboard/notifications'},{value:'resolved',label:t('resolved'),href:'/dashboard/notifications?status=resolved'}]}/></div>
 <Notice variant={emailEnabled?'success':'default'} className="mb-4">{t(emailEnabled?'emailEnabled':'emailDisabled')}</Notice>
 {!list.items.length?<Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</CardContent></Card>:<div className="space-y-3">{list.items.map(item=>{
  const kind=notificationKind(item.type,item.reason),destination=kind==='revocation'?'/dashboard/external-revocations':kind==='unknown'?'/dashboard/external-reviews':`/dashboard/products/${item.product_id}`;
  return <Card key={item.id} size="compact"><CardContent className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{item.product_name}</h2><AnimatedBadge size="sm" status={item.resolved_at===null?(tone as Record<string,'warning'|'danger'>)[kind]??'info':'success'}>{t(`kinds.${kind}`)}</AnimatedBadge></div><p className="text-sm text-muted-foreground">{t(item.resolved_at===null?`details.${kind}`:'resolvedDetail')}</p></div><Link className="inline-flex items-center gap-1 text-sm font-medium hover:underline" href={destination}>{t(kind==='unknown'?'review':kind==='revocation'?'revocations':'product')} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden/></Link></div>
  <dl className="grid gap-3 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-3"><div className="min-w-0"><dd className="break-all font-mono">{t('operation',{id:item.operation_id})}</dd></div><div><dd>{t('occurrences',{count:item.occurrences})} · {format.dateTime(item.updated_at,{dateStyle:'medium',timeStyle:'short'})}</dd></div><div><dd>{t('emailStatus',{status:t(`emailStates.${item.email_status??'none'}`)})}</dd></div></dl></CardContent></Card>;
 })}</div>}<PrevNext page={page} hasMore={list.hasMore}/></>;
}
