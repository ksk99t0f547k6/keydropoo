import type {MetadataRoute} from 'next';
import {siteOrigin} from '@/lib/server/public-site';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return {rules: {userAgent: '*', allow: '/', disallow: ['/api/', '/mcp', '/dashboard', '/my-codes', '/account/', '/reset-password', '/orders/', '/claim/', '/redeem/', '/buy/', '/setup', '/sign-in']}, ...(origin ? {sitemap: `${origin}/sitemap.xml`} : {})};
}
