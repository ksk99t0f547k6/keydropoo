import {getTranslations} from 'next-intl/server';
import {siteOrigin} from './public-site';
import {publicIndex} from '@/lib/public-site';

export async function llmsResponse(full: boolean) {
  const t = await getTranslations();
  const entries = publicIndex(await siteOrigin());
  const lines = [`# ${t('common.brand')}`, '', `> ${t('home.description')}`, ''];
  for(const {path, url} of entries) {
    const title = path === '/' ? t('common.brand') : path === '/features' ? t('publicSite.features') : t(`publicSite.${path.slice(1)}.label`);
    lines.push(`- [${title}](${url})`);
    if(full) {
      if(path === '/') lines.push('', t('home.description'), '');
      else if(path === '/features') for(const key of ['inventory', 'campaigns', 'payments', 'rewards', 'integrations', 'ownership']) lines.push('', `## ${t(`publicSite.featureGroups.${key}.title`)}`, t(`publicSite.featureGroups.${key}.body`), '');
      else if(path === '/docs') for(const key of ['claim', 'buy', 'redeem']) lines.push('', `## ${t(`publicSite.docs.sections.${key}.title`)}`, t(`publicSite.docs.sections.${key}.body`), '');
      else if(path === '/pricing') lines.push('', t('publicSite.pricing.body'), t('publicSite.pricing.note'), '');
      else if(path === '/demo') lines.push('', t('publicSite.demo.description'), t('publicSite.demo.notice'), '');
      else if(path === '/changelog') lines.push('', t('publicSite.changelog.empty'), '');
    }
  }
  return new Response(lines.join('\n') + '\n', {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}});
}
