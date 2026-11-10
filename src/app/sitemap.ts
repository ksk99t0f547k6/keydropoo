import type {MetadataRoute} from 'next';
import {siteOrigin} from '@/lib/server/public-site';
import {localizedIndex} from '@/lib/public-site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return localizedIndex(await siteOrigin());
}
