// Tells IndexNow (Bing, Yandex, Seznam, Naver and others) which public pages changed, so they can
// recrawl them. Run it by hand after a deploy; it is not part of CI.
//
//   node web/scripts/indexnow.mjs                 every URL in the live sitemap
//   node web/scripts/indexnow.mjs /pricing /guides/how-to-study-for-finals
//   node web/scripts/indexnow.mjs --dry-run       print what would be sent, send nothing
//   node web/scripts/indexnow.mjs --sitemap https://classroom.cordiaai.io/sitemap.xml
//
// The key is the name and content of the file at the site root (web/public/<key>.txt), which is
// how IndexNow checks that the site asked for the crawl: it is public by design, not a secret.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from '../lib/brand.mjs';

export const ENDPOINT = 'https://api.indexnow.org/indexnow';
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const KEY_FILE = /^([a-f0-9]{32})\.txt$/;
const MAX_URLS = 10000;

export function indexNowKey(dir = PUBLIC) {
  const keys = readdirSync(dir).map(name => KEY_FILE.exec(name)?.[1]).filter(Boolean);
  if (keys.length !== 1) throw new Error(`Expected one IndexNow key file in ${dir}, found ${keys.length}.`);
  return keys[0];
}

// <loc> values from a sitemap.
export const sitemapUrls = xml => [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1].trim());

// Absolute URLs on this site only: paths become SITE_URL + path, other hosts are refused.
export function siteUrls(items, site = SITE_URL) {
  const host = new URL(site).host;
  const urls = items.map(item => new URL(item, site));
  for (const url of urls) if (url.host !== host) throw new Error(`${url.href} isn't on ${host}.`);
  return [...new Set(urls.map(url => url.href))];
}

export function payload(urls, key = indexNowKey(), site = SITE_URL) {
  const { host, origin } = new URL(site);
  return { host, key, keyLocation: `${origin}/${key}.txt`, urlList: urls.slice(0, MAX_URLS) };
}

const MEANING = {
  200: 'accepted', 202: 'accepted; the key file is still being checked',
  400: 'bad request', 403: 'the key file was not found or does not match',
  422: 'a URL is not on this host, or the key does not match', 429: 'too many requests: try later',
};

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const at = argv.indexOf('--sitemap');
  const sitemap = at >= 0 ? argv[at + 1] : `${SITE_URL}/sitemap.xml`;
  const given = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--sitemap');
  let items = given;
  if (!items.length) {
    const response = await fetch(sitemap);
    if (!response.ok) throw new Error(`${sitemap} answered ${response.status}.`);
    items = sitemapUrls(await response.text());
  }
  const body = payload(siteUrls(items));
  console.log(`${body.urlList.length} URL(s) for ${body.host}:\n${body.urlList.map(url => `  ${url}`).join('\n')}`);
  if (dryRun) { console.log('\nDry run: nothing sent.'); return; }
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  console.log(`\nIndexNow answered ${response.status} (${MEANING[response.status] || 'see indexnow.org/documentation'}).`);
  if (response.status >= 400) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
