import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {isPublicPageEnabled} from '@/config/site';
import {PublicShell} from '@/components/site/public-shell';
import {DemoInventory} from '@/components/site/demo-inventory';
import {pageMetadata} from '@/lib/server/public-site';

type Props = {params: Promise<{section: string}>};
export async function generateMetadata({params}: Props) {
  const {section} = await params;
  if(!isPublicPageEnabled(section)) notFound();
  return pageMetadata(`/${section}`, `publicSite.${section}.label`, `publicSite.${section}.description`);
}
export default async function OptionalPage({params}: Props) {
  const {section} = await params;
  if(!isPublicPageEnabled(section)) notFound();
  const t = await getTranslations('publicSite');
  return <PublicShell><section className="public-copy">
    <p className="eyebrow">{t(`${section}.label`)}</p><h1>{t(`${section}.title`)}</h1><p className="intro">{t(`${section}.description`)}</p>
    {section === 'docs' && <div className="public-grid">{['claim', 'buy', 'redeem'].map(key => <article key={key}>
      <h2>{t(`docs.sections.${key}.title`)}</h2><p>{t(`docs.sections.${key}.body`)}</p>
    </article>)}</div>}
    {section === 'pricing' && <div className="public-body space-y-6"><p>{t('pricing.body')}</p><p>{t('pricing.note')}</p></div>}
    {section === 'demo' && <><p className="rounded-lg border border-border p-4 text-sm">{t('demo.notice')}</p><DemoInventory /></>}
    {section === 'changelog' && <p className="public-body">{t('changelog.empty')}</p>}
  </section></PublicShell>;
}
