import type {Metadata} from 'next';
import {publicPaths, publicSite} from '@/config/site';
import {defaultLocale, localizedPath, locales, ogLocales, type Locale} from '@/i18n/locales';

// 只接受已設定的 origin，避免預設範本網址或請求 Host 汙染 canonical。
export function normalizeSiteOrigin(value: unknown): string | null {
  if(typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if(url.hostname === 'example.com' || url.hostname.endsWith('.example') || url.hostname.endsWith('.invalid')) return null;
    return url.origin;
  } catch { return null; }
}

// 每種語言都有 /<語言>/… 網址；不帶前綴的網址當 x-default（依訪客語言顯示）。
export function localeAlternates(origin: string, path: string): Record<Locale | 'x-default', string> {
  return {
    ...(Object.fromEntries(locales.map(locale => [locale, new URL(localizedPath(locale, path), origin).href])) as Record<Locale, string>),
    'x-default': new URL(path, origin).href,
  };
}

// urlLocale：這次請求網址帶的語言前綴（沒有就是 null）；locale：實際顯示的語言。
export function publicMetadata(origin: string | null, path: string, title: string, description: string, brand: string, locale: Locale = defaultLocale, urlLocale: Locale | null = null): Metadata {
  const url = origin ? new URL(localizedPath(urlLocale, path), origin).href : undefined;
  return {
    title, description, robots: {index: !!origin, follow: true},
    ...(url && origin ? {alternates: {canonical: url, languages: localeAlternates(origin, path)}} : {}),
    openGraph: {type: 'website', title, description, siteName: brand, locale: ogLocales[locale], alternateLocale: locales.filter(item => item !== locale).map(item => ogLocales[item]), ...(url ? {url, images: [{url: `${origin}/share-image.png`, width: 1200, height: 630, alt: brand}]} : {})},
    twitter: {card: 'summary_large_image', title, description, ...(origin ? {images: [`${origin}/share-image.png`]} : {})},
  };
}

export function websiteSchema(origin: string | null, name: string, description: string, locale: Locale = defaultLocale) {
  if(!origin) return null;
  const graph: Record<string, unknown>[] = [{
    '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name, description, inLanguage: locale,
    ...(publicSite.organizationName ? {publisher: {'@id': `${origin}/#organization`}} : {}),
  }];
  if(publicSite.organizationName) graph.push({'@type': 'Organization', '@id': `${origin}/#organization`, name: publicSite.organizationName, url: `${origin}/`});
  return JSON.stringify({'@context': 'https://schema.org', '@graph': graph}).replace(/</g, '\\u003c');
}

export function publicIndex(origin: string | null) {
  return origin ? publicPaths().map(path => ({path, url: new URL(path, origin).href})) : [];
}

// sitemap：每個公開頁面列出不帶前綴與各語言網址，並互相標示 hreflang。
export function localizedIndex(origin: string | null) {
  if(!origin) return [];
  return publicPaths().flatMap(path => {
    const languages = localeAlternates(origin, path);
    return [new URL(path, origin).href, ...locales.map(locale => languages[locale])].map(url => ({url, alternates: {languages}}));
  });
}
