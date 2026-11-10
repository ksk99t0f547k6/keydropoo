import {getTranslations} from 'next-intl/server';
import {PublicShell} from '@/components/site/public-shell';
import {pageMetadata} from '@/lib/server/public-site';

export function generateMetadata() { return pageMetadata('/features', 'publicSite.features', 'publicSite.featureDescription'); }
export default async function Features() {
  const t = await getTranslations('publicSite');
  return <PublicShell><section className="public-copy">
    <p className="eyebrow">{t('features')}</p><h1>{t('featureTitle')}</h1><p className="intro">{t('featureDescription')}</p>
    <div className="public-grid">{['inventory', 'campaigns', 'payments', 'rewards', 'integrations', 'ownership'].map(key => <article key={key}>
      <h2>{t(`featureGroups.${key}.title`)}</h2><p>{t(`featureGroups.${key}.body`)}</p>
    </article>)}</div>
  </section></PublicShell>;
}
