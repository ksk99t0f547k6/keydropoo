import {getLocale, getTranslations} from 'next-intl/server';
import type {Locale} from '@/i18n/locales';
import {PublicShell} from '@/components/site/public-shell';
import {FactsSection, FeaturesSection, HeroSection, LogosSection, StartSection, StepsSection} from '@/components/site/landing/sections';
import {publicSite} from '@/config/site';
import {localeHref, pageMetadata, siteOrigin} from '@/lib/server/public-site';
import {websiteSchema} from '@/lib/public-site';

export function generateMetadata() { return pageMetadata('/', 'common.brand', 'home.description'); }

// 首頁：區塊與順序由 src/config/site.ts 的 publicSite.sections 決定，畫面在 src/components/site/landing/。
export default async function Home() {
  const t = await getTranslations();
  const schema = websiteSchema(await siteOrigin(), t('common.brand'), t('home.description'), (await getLocale()) as Locale);
  const featuresHref = await localeHref('/features');
  const render = {
    hero: () => <HeroSection featuresHref={featuresHref} />,
    logos: () => <LogosSection />,
    features: () => <FeaturesSection />,
    steps: () => <StepsSection />,
    facts: () => <FactsSection />,
    start: () => <StartSection featuresHref={featuresHref} />,
  };
  return <PublicShell landing>
    {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{__html: schema}} />}
    {publicSite.sections.map(section => <div key={section}>{render[section]()}</div>)}
  </PublicShell>;
}
