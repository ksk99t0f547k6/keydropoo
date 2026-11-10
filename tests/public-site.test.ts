import {afterEach, expect, it, vi} from 'vitest';
import {publicSite, optionalPageNames} from '../src/config/site';
import {normalizeSiteOrigin, publicMetadata, publicIndex, websiteSchema} from '../src/lib/public-site';
import {localizedPath, splitLocalePath} from '../src/i18n/locales';
import messages from '../messages/en.json';

const fixture = vi.hoisted(() => ({origin: 'https://codes.test' as string | null}));
vi.mock('../src/lib/server/public-site', () => ({siteOrigin: async () => fixture.origin, pageMetadata: vi.fn()}));
vi.mock('next/navigation', () => ({notFound: () => {throw new Error('NOT_FOUND');}}));
// next/font 只在 Next 編譯時可用，測試裡換成空的字型變數。
vi.mock('../src/lib/fonts', () => ({sans: {variable: ''}, mono: {variable: ''}}));
vi.mock('next-intl/server', () => ({getTranslations: async () => (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], messages)}));
import OptionalPage, {generateMetadata} from '../src/app/[section]/page';
import sitemap from '../src/app/sitemap';
import {llmsResponse} from '../src/lib/server/llms';

afterEach(() => {for(const key of optionalPageNames) publicSite.pages[key] = false; publicSite.organizationName = null; fixture.origin = 'https://codes.test';});

it('canonical 不信任路徑、憑證、非 HTTPS 或範本網址；允許本機驗收', () => {
  for(const value of [undefined, '', 'javascript:alert(1)', 'https://user:pass@codes.test', 'https://codes.test/path', 'https://codes.test/?q=x', 'https://codes.test/#x', 'http://codes.test', 'https://keydrop.example', 'https://example.com']) expect(normalizeSiteOrigin(value)).toBeNull();
  expect(normalizeSiteOrigin('https://codes.test/')).toBe('https://codes.test');
  expect(normalizeSiteOrigin('http://localhost:3100')).toBe('http://localhost:3100');
  const meta = publicMetadata(null, '/', 'Title', 'Description', 'Brand');
  expect(meta.alternates).toBeUndefined();expect(meta.robots).toEqual({index: false, follow: true});
  const configured = publicMetadata('https://codes.test', '/features', 'Title', 'Description', 'Brand');
  expect(configured.alternates?.canonical).toBe('https://codes.test/features');
  expect(configured.openGraph?.images).toEqual([{url: 'https://codes.test/share-image.png', width: 1200, height: 630, alt: 'Brand'}]);
  expect(configured.alternates?.languages).toMatchObject({en: 'https://codes.test/en/features', ja: 'https://codes.test/ja/features', 'x-default': 'https://codes.test/features'});
  const japanese = publicMetadata('https://codes.test', '/features', 'Title', 'Description', 'Brand', 'ja', 'ja');
  expect(japanese.alternates?.canonical).toBe('https://codes.test/ja/features');
  expect(japanese.openGraph).toMatchObject({locale: 'ja_JP'});
  const home = publicMetadata('https://codes.test', '/', 'Title', 'Description', 'Brand', 'ar', 'ar');
  expect(home.alternates?.canonical).toBe('https://codes.test/ar');
});

it('語言網址前綴的解析與組合', () => {
  expect(splitLocalePath('/ja/features')).toEqual({locale: 'ja', path: '/features'});
  expect(splitLocalePath('/zh-hant/claim/launch')).toEqual({locale: 'zh-Hant', path: '/claim/launch'});
  expect(splitLocalePath('/ar')).toEqual({locale: 'ar', path: '/'});
  expect(splitLocalePath('/features')).toEqual({locale: null, path: '/features'});
  expect(splitLocalePath('/fr/features')).toEqual({locale: null, path: '/fr/features'});
  expect(splitLocalePath('/japan')).toEqual({locale: null, path: '/japan'});
  expect(localizedPath('ko', '/')).toBe('/ko');expect(localizedPath('ko', '/features')).toBe('/ko/features');expect(localizedPath(null, '/features')).toBe('/features');
});

it('停用的公開頁面同時拒絕內容及 metadata，不能猜路徑繞過', async () => {
  for(const section of [...optionalPageNames, 'unknown', 'toString', '__proto__']) {
    await expect(OptionalPage({params: Promise.resolve({section})})).rejects.toThrow('NOT_FOUND');
    await expect(generateMetadata({params: Promise.resolve({section})})).rejects.toThrow('NOT_FOUND');
  }
});

it('搜尋索引與 AI 文件只列已啟用公開頁，不讀取交易或管理資料', async () => {
  expect(publicIndex(fixture.origin).map(row => row.path)).toEqual(['/', '/features']);
  publicSite.pages.docs = true;publicSite.pages.demo = true;
  const rows = await sitemap();const urls = rows.map(row => row.url);
  // 每個公開頁面：不帶前綴的網址加上 8 種語言網址。
  expect(urls).toHaveLength(4 * 9);
  for(const path of ['/features', '/docs', '/demo']) for(const prefix of ['', '/en', '/ja', '/zh-Hant', '/ar']) expect(urls).toContain(`https://codes.test${prefix}${path}`);
  expect(urls).toContain('https://codes.test/ja');expect(urls).toContain('https://codes.test/');
  expect(urls.some(url => /pricing|changelog|dashboard/.test(url))).toBe(false);
  expect(rows.find(row => row.url === 'https://codes.test/ja/docs')?.alternates?.languages).toMatchObject({'zh-Hant': 'https://codes.test/zh-Hant/docs', 'x-default': 'https://codes.test/docs'});
  for(const full of [true, false]) {
    const response = await llmsResponse(full), text = await response.text();
    expect(text).toContain('https://codes.test/docs');expect(text).toContain('https://codes.test/demo');
    for(const path of ['/pricing', '/changelog', '/dashboard', '/orders', '/claim', '/api/', '/my-codes']) expect(text).not.toContain(`https://codes.test${path}`);
    if(full) expect(text).toContain(messages.publicSite.demo.notice);
  }
  fixture.origin = null;expect(await sitemap()).toEqual([]);
});

it('結構化資料不虛構經營者且不能用文案關閉 script 標籤', () => {
  expect(websiteSchema(null, 'Brand', 'Description')).toBeNull();
  const raw = websiteSchema('https://codes.test', '</script><script>alert(1)</script>', 'Description')!;
  expect(raw).not.toContain('<');expect(JSON.parse(raw)['@graph']).toHaveLength(1);
  publicSite.organizationName = 'Product owner';
  const graph = JSON.parse(websiteSchema('https://codes.test', 'Brand', 'Description')!)['@graph'];
  expect(graph).toHaveLength(2);expect(graph[1].name).toBe('Product owner');
});
