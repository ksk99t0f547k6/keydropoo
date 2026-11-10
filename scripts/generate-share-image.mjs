import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';

// 只在建置／啟動時繪圖，不把圖片渲染器打包進正式 Worker。
// 分享圖用 public/brand/ 的字標和圖示，加上 messages/en.json 的首頁標題；換品牌時替換那兩個 SVG 即可。
// 「加到主畫面」的 App 圖示是 public/icons/ 的靜態檔，不在這裡產生。
const require = createRequire(import.meta.url);
const {ImageResponse} = require('next/og');
const {createElement: h} = require('react');
const messages = JSON.parse(await readFile(new URL('../messages/en.json', import.meta.url), 'utf8'));
const asset = async (file) => `data:image/svg+xml;base64,${(await readFile(new URL(`../public/brand/${file}`, import.meta.url))).toString('base64')}`;
const wordmark = await asset('keydrop-wordmark.svg');
const icon = await asset('keydrop-icon.svg');
// 字標比例來自 viewBox，避免圖片變形。
const [, , vbWidth, vbHeight] = (await readFile(new URL('../public/brand/keydrop-wordmark.svg', import.meta.url), 'utf8')).match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const wordmarkHeight = 72;

const response = new ImageResponse(h('div', {style: {
  width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
  justifyContent: 'space-between', padding: 80, background: '#f4f3ef', color: '#1e2230',
}},
  h('img', {src: wordmark, alt: messages.common.brand, width: Math.round(wordmarkHeight * vbWidth / vbHeight), height: wordmarkHeight}),
  h('div', {style: {display: 'flex', fontSize: 76, fontWeight: 600, lineHeight: 1.1, letterSpacing: -2, maxWidth: 820}}, messages.home.title.replace(/<\/?[a-z]+>/g, '')),
  h('div', {style: {display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between'}},
    h('div', {style: {display: 'flex', fontSize: 22, color: '#6b6e78', letterSpacing: 1}}, messages.home.eyebrow),
    h('img', {src: icon, alt: '', width: 112, height: 112}),
  ),
), {width: 1200, height: 630});
if(!response.ok) throw new Error('SHARE_IMAGE_GENERATION_FAILED');
await mkdir(new URL('../public/', import.meta.url), {recursive: true});
await writeFile(new URL('../public/share-image.png', import.meta.url), new Uint8Array(await response.arrayBuffer()));
