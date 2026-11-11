// First-touch attribution (lib/attribution.mjs), the AI crawler log (proxy.js, lib/aiCrawlers.mjs)
// and IndexNow (scripts/indexnow.mjs). tests/test_acquisition.py covers the backend side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { AI_ENGINE_NAMES, FIRST_TOUCH_KEY, aiEngine, firstTouchForSignup, firstTouchFrom, recordFirstTouch } from '../lib/attribution.mjs';
import { AI_CRAWLERS, crawlerFrom, crawlerLogLine, isPagePath } from '../lib/aiCrawlers.mjs';
import { indexNowKey, payload, siteUrls, sitemapUrls } from '../scripts/indexnow.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 9, 12);
const memory = () => {
  const data = new Map();
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data };
};

test('AI assistants are recognised from the referrer or utm_source', () => {
  assert.equal(aiEngine({ referrerHost: 'chatgpt.com' }), 'chatgpt');
  assert.equal(aiEngine({ referrerHost: 'chat.openai.com' }), 'chatgpt');
  assert.equal(aiEngine({ referrerHost: 'www.perplexity.ai' }), 'perplexity');
  assert.equal(aiEngine({ referrerHost: 'gemini.google.com' }), 'gemini');
  assert.equal(aiEngine({ referrerHost: 'copilot.microsoft.com' }), 'copilot');
  assert.equal(aiEngine({ referrerHost: 'claude.ai' }), 'claude');
  assert.equal(aiEngine({ utmSource: 'chatgpt.com' }), 'chatgpt');
  assert.equal(aiEngine({ utmSource: 'https://perplexity.ai/' }), 'perplexity');
  assert.equal(aiEngine({ referrerHost: 'www.bing.com', referrerPath: '/chat' }), 'bing_chat');
  assert.equal(aiEngine({ referrerHost: 'www.bing.com', referrerPath: '/search' }), null, 'plain Bing search is not an AI assistant');
  assert.equal(aiEngine({ referrerHost: 'google.com' }), null);
  assert.equal(aiEngine({ referrerHost: 'notchatgpt.com' }), null, 'only the host or its subdomains');
  assert.equal(aiEngine({ utmSource: 'gemini' }), null, 'utm_source must name the host');
});

test('a first touch holds a path, a referring host, campaign tags, ?from= and the AI engine, nothing personal', () => {
  const touch = firstTouchFrom({ href: 'https://classroom.cordiaai.io/ai-quiz-generator?utm_source=chatgpt.com&utm_campaign=fall&ref=campus-ambassador&from=ai-quiz-generator&email=x@y.z', referrer: 'https://chatgpt.com/c/abc123', now: NOW });
  assert.deepEqual(touch, { at: NOW, landing_path: '/ai-quiz-generator', referrer_host: 'chatgpt.com', utm_source: 'chatgpt.com', utm_medium: null, utm_campaign: 'fall', ref: 'campus-ambassador', from: 'ai-quiz-generator', ai_engine: 'chatgpt' });
  assert.ok(!JSON.stringify(touch).includes('x@y.z') && !JSON.stringify(touch).includes('abc123'), 'no query values or referrer paths beyond the allowlist');
  const internal = firstTouchFrom({ href: 'https://classroom.cordiaai.io/pricing', referrer: 'https://classroom.cordiaai.io/', now: NOW });
  assert.equal(internal.referrer_host, null, 'a referrer from this site is not a source');
  assert.equal(firstTouchFrom({ href: 'https://classroom.cordiaai.io/?from=Bad%20Value', now: NOW }).from, null);
  assert.equal(firstTouchFrom({ href: `https://classroom.cordiaai.io/?utm_source=${'x'.repeat(300)}`, now: NOW }).utm_source.length, 100);
});

test('a first touch is never overwritten within 30 days', () => {
  const storage = memory();
  const first = recordFirstTouch({ href: 'https://classroom.cordiaai.io/canvas-study-tool', referrer: 'https://www.perplexity.ai/', storage, now: NOW });
  const later = recordFirstTouch({ href: 'https://classroom.cordiaai.io/pricing', referrer: 'https://chatgpt.com/', storage, now: NOW + 29 * DAY });
  assert.deepEqual(later, first);
  assert.equal(JSON.parse(storage.getItem(FIRST_TOUCH_KEY)).ai_engine, 'perplexity');
  const renewed = recordFirstTouch({ href: 'https://classroom.cordiaai.io/pricing', referrer: 'https://chatgpt.com/', storage, now: NOW + 31 * DAY });
  assert.equal(renewed.ai_engine, 'chatgpt', 'after 30 days the old one has expired');
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(recordFirstTouch({ href: 'https://classroom.cordiaai.io/', storage: blocked, now: NOW }), null);
});

test('sign-up sends the first touch with a date, not a timestamp', () => {
  const storage = memory();
  recordFirstTouch({ href: 'https://classroom.cordiaai.io/signup?from=install-extension', referrer: 'https://claude.ai/', storage, now: NOW });
  const sent = firstTouchForSignup({ storage, now: NOW + DAY });
  assert.equal(sent.first_seen, '2026-11-09');
  assert.equal(sent.at, undefined);
  assert.equal(sent.ai_engine, 'claude');
  assert.equal(firstTouchForSignup({ storage, now: NOW + 31 * DAY }), null, 'an expired first touch is not sent');
});

test('the browser and the backend agree on the fields and engines', async () => {
  const backend = await readFile(new URL('../../backend/services/acquisition.py', import.meta.url), 'utf8');
  const fields = [...backend.match(/FIELDS = \(([^)]+)\)/)[1].matchAll(/"([a-z_]+)"/g)].map(match => match[1]);
  const engines = [...backend.match(/AI_ENGINES = \(([^)]+)\)/)[1].matchAll(/"([a-z_]+)"/g)].map(match => match[1]);
  const touch = firstTouchForSignup({ storage: (() => { const s = memory(); recordFirstTouch({ href: 'https://classroom.cordiaai.io/', storage: s, now: NOW }); return s; })(), now: NOW });
  assert.deepEqual(Object.keys(touch).sort(), [...fields].sort());
  assert.deepEqual([...engines].sort(), [...AI_ENGINE_NAMES].sort());
  const age = await readFile(new URL('../lib/ageCheck.js', import.meta.url), 'utf8');
  assert.match(age, /firstTouchForSignup\(/);
  const app = await readFile(new URL('../pages/_app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(getToken\(\) \|\| !publicPage\(window\.location\.pathname\)\) return;/, 'signed-out visitors on public pages only');
});

test('crawler user agents are recognised by name, any case', () => {
  assert.equal(crawlerFrom('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'), 'GPTBot');
  assert.equal(crawlerFrom('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'), 'Bingbot');
  assert.equal(crawlerFrom('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'), 'ClaudeBot');
  assert.equal(crawlerFrom('Mozilla/5.0 ... Claude-User/1.0'), 'Claude-User');
  assert.equal(crawlerFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36'), null);
  assert.equal(crawlerFrom('NotGPTBotLike'), null);
  assert.equal(crawlerLogLine({ bot: 'GPTBot', path: '/pricing', status: 200 }), '{"type":"ai_crawler","bot":"GPTBot","path":"/pricing","status":200}');
  assert.ok(isPagePath('/pricing') && !isPagePath('/icon128.png') && !isPagePath('/_next/static/x') && !isPagePath('/api/visual'));
});

// proxy.js imports next/server, which plain Node can't resolve outside Next: read its matcher instead.
async function proxyMatcher() {
  const source = await readFile(new URL('../proxy.js', import.meta.url), 'utf8');
  return {
    source: source.match(/source: '([^']+)'/)[1].replace(/\\\\/g, '\\'),
    userAgent: source.match(/key: 'user-agent', value: '([^']+)'/)[1],
  };
}

test('the proxy only runs for these crawlers, on pages, never for visitors', async () => {
  const rule = await proxyMatcher();
  const ua = new RegExp(`^${rule.userAgent}$`);
  for (const name of AI_CRAWLERS) assert.ok(ua.test(`Mozilla/5.0 (compatible; ${name}/1.0)`) || ua.test(`Mozilla/5.0 (compatible; ${name.toLowerCase()}/1.0)`), `${name} is missing from the matcher`);
  assert.ok(ua.test('Mozilla/5.0 (compatible; bingbot/2.0)'));
  assert.ok(!ua.test('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'));
  assert.ok(!ua.test('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'));
  const source = new RegExp(`^${rule.source.replace('/(', '/(?:')}$`);
  assert.ok(source.test('/pricing') && source.test('/guides/how-to-study-for-finals'));
  assert.ok(!source.test('/_next/static/chunks/a.js') && !source.test('/icon128.png') && !source.test('/api/visual'));
});

test('IndexNow: the key file is served at the root, and only this site\'s URLs are sent', async () => {
  const key = indexNowKey();
  assert.match(key, /^[a-f0-9]{32}$/);
  assert.equal(await readFile(new URL(`../public/${key}.txt`, import.meta.url), 'utf8'), key);
  assert.deepEqual(sitemapUrls('<urlset><url><loc>https://classroom.cordiaai.io/</loc></url><url><loc> https://classroom.cordiaai.io/pricing </loc></url></urlset>'), ['https://classroom.cordiaai.io/', 'https://classroom.cordiaai.io/pricing']);
  assert.deepEqual(siteUrls(['/pricing', 'https://classroom.cordiaai.io/pricing']), ['https://classroom.cordiaai.io/pricing']);
  assert.throws(() => siteUrls(['https://example.com/x']), /isn't on classroom\.cordiaai\.io/);
  assert.deepEqual(payload(['https://classroom.cordiaai.io/pricing'], key), { host: 'classroom.cordiaai.io', key, keyLocation: `https://classroom.cordiaai.io/${key}.txt`, urlList: ['https://classroom.cordiaai.io/pricing'] });
  const workflows = new URL('../../.github/workflows/', import.meta.url);
  for (const file of await readdir(workflows)) assert.doesNotMatch(await readFile(new URL(file, workflows), 'utf8'), /indexnow/i, `${file} must not run IndexNow`);
});

test('the privacy policy mentions first-party referral attribution', async () => {
  const policy = await readFile(new URL('../pages/privacy.js', import.meta.url), 'utf8');
  assert.match(policy, /your browser keeps a note for 30 days of the page you landed on and what referred you/);
});
