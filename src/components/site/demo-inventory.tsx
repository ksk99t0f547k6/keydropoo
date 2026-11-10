'use client';
import {useTranslations, useFormatter} from 'next-intl';
import {Table} from '@/components/motion/table';

// 公開展示永遠只用固定範例，不讀資料庫或呼叫管理 API。
const rows = [{id: 'launch', kind: 'redemption', remaining: 240}, {id: 'partners', kind: 'discount', remaining: 120}, {id: 'licenses', kind: 'license', remaining: 80}];
export function DemoInventory() {
  const t = useTranslations('publicSite.demo'), format = useFormatter();
  return <div className="mt-8 space-y-6">
    <div className="grid gap-4 sm:grid-cols-3">{[['available', 440], ['claimed', 60], ['campaigns', 3]].map(([key, value]) => <article className="rounded-xl border border-border p-6" key={key}>
      <p className="text-sm text-muted-foreground">{t(String(key))}</p><p className="mt-3 text-3xl">{format.number(Number(value))}</p>
    </article>)}</div>
    <div className="hidden sm:block"><Table data={rows} getRowId={row => row.id} height={270} columns={[
      {key: 'id', header: t('batch'), cell: row => t(`rows.${row.id}`)},
      {key: 'kind', header: t('type'), cell: row => t(`kinds.${row.kind}`)},
      {key: 'remaining', header: t('remaining'), cell: row => format.number(row.remaining)},
    ]} /></div>
    <div className="space-y-4 sm:hidden">{rows.map(row => <article className="rounded-xl border border-border p-5" key={row.id}>
      <h2>{t(`rows.${row.id}`)}</h2><p className="public-body">{t(`kinds.${row.kind}`)} · {t('remaining')}: {format.number(row.remaining)}</p>
    </article>)}</div>
  </div>;
}
