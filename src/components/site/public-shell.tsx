import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { optionalPageNames, publicSite } from '@/config/site';
import { localeHref } from '@/lib/server/public-site';
import { BrandWordmark } from "@/components/site/brand-logo";
import { mono, sans } from '@/lib/fonts';
import { PoweredBy } from '@/components/site/powered-by';

// 公開頁外框。landing 時頁首改成浮在內容上的半透明列，頁尾不加上邊框以外的裝飾。
export async function PublicShell({children, landing = false}: {children: React.ReactNode; landing?: boolean}) {
  const t = await getTranslations();
  const [home, features, ...optional] = await Promise.all(['/', '/features', ...optionalPageNames.filter(name => publicSite.pages[name]).map(name => `/${name}`)].map(localeHref));
  return <div className={`${sans.variable} ${mono.variable} public-root${landing ? ' public-landing' : ''}`}>
    <a className="skip-link" href="#main-content">{t('publicSite.skip')}</a>
    <header className="site-header public-header">
      <Link className="wordmark" href={home}><BrandWordmark label={t('common.brand')}/></Link>
      <nav aria-label={t('publicSite.navigation')}>
        <Link href={features}>{t('publicSite.features')}</Link>
        {optionalPageNames.filter(name => publicSite.pages[name]).map((name, index) => <Link key={name} href={optional[index]}>{t(`publicSite.${name}.label`)}</Link>)}
        <Link href="/sign-in">{t('common.signIn')} <span aria-hidden>↗</span></Link>
      </nav>
    </header>
    <main id="main-content" tabIndex={-1}>{children}</main>
    <footer className="site-header public-footer"><span>{t('common.brand')} © {new Date().getFullYear()}</span><PoweredBy/><Link href={features}>{t('publicSite.features')}</Link></footer>
  </div>;
}
