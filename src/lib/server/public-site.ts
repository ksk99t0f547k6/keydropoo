import {getCloudflareContext} from '@opennextjs/cloudflare';
import {connection} from 'next/server';
import {getLocale, getTranslations} from 'next-intl/server';
import {headers} from 'next/headers';
import {isLocale, LOCALE_HEADER, localizedPath, type Locale} from '@/i18n/locales';
import {normalizeSiteOrigin, publicMetadata} from '@/lib/public-site';

export async function siteOrigin() {
  await connection();
  const {env} = await getCloudflareContext({async: true});
  return normalizeSiteOrigin(process.env.NODE_ENV === 'development' ? process.env.APP_URL ?? env.APP_URL : env.APP_URL);
}

// 這次請求的網址語言前綴（/ja/… 由 proxy 帶入），沒有前綴時是 null。
export async function urlLocale(): Promise<Locale | null> {
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : null;
}

// 公開頁面內部連結：在語言網址底下時保留前綴。
export async function localeHref(path: string) {
  return localizedPath(await urlLocale(), path);
}

export async function pageMetadata(path: string, titleKey: string, descriptionKey: string) {
  const [origin, t, locale, prefix] = await Promise.all([siteOrigin(), getTranslations(), getLocale(), urlLocale()]);
  return publicMetadata(origin, path, t(titleKey), t(descriptionKey), t('common.brand'), locale as Locale, prefix);
}
