'use client';
import {useTranslations,useFormatter} from 'next-intl';
import {Table} from '@/components/motion/table';
import type {ProductEntitlements} from '@/lib/server/admin-entitlements';

type Operation=Extract<ProductEntitlements,{view:'wallet'}>['operations'][number];
export function CreditTransactions({operations}:{operations:Operation[]}){
 const t=useTranslations('adminEntitlements'),format=useFormatter();
 const amount=(value:number)=>format.number(value,{signDisplay:'exceptZero'});
 return <><div className="hidden lg:block"><Table data={operations} getRowId={row=>row.id} height={400} rowHeight={110} emptyState={<p className="p-6">{t('emptyTransactions')}</p>} columns={[
  {key:'kind',header:t('operation'),width:'180px',cell:row=><div><p>{t(`kinds.${row.kind}`)}</p><p className="mt-2 text-xs text-muted-foreground">{format.dateTime(row.created_at,{dateStyle:'medium',timeStyle:'short'})}</p></div>},
  {key:'amount',header:t('requested'),width:'130px',cell:row=>row.kind==='revoke'?t('remaining'):format.number(row.amount)},
  {key:'balance_delta',header:t('balanceChange'),width:'140px',cell:row=>amount(row.balance_delta)},
  {key:'id',header:t('references'),width:'400px',cell:row=><div className="space-y-2 break-all font-mono text-xs"><p>{row.id}</p>{row.related_id&&<p className="text-muted-foreground">{t('related',{id:row.related_id})}</p>}</div>},
 ]}/></div><div className="space-y-4 lg:hidden">{!operations.length&&<p>{t('emptyTransactions')}</p>}{operations.map(row=><article key={row.id} className="space-y-3 rounded-xl border border-border p-5"><div className="flex items-start justify-between gap-3"><h3>{t(`kinds.${row.kind}`)}</h3><span>{amount(row.balance_delta)}</span></div><p className="text-sm text-muted-foreground">{format.dateTime(row.created_at,{dateStyle:'medium',timeStyle:'short'})}</p><p className="text-sm">{t('requestedAmount',{amount:row.kind==='revoke'?t('remaining'):format.number(row.amount)})}</p><p className="break-all font-mono text-xs">{row.id}</p>{row.related_id&&<p className="break-all font-mono text-xs text-muted-foreground">{t('related',{id:row.related_id})}</p>}</article>)}</div></>;
}
