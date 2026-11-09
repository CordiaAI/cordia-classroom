// Builds the site (skip with --skip-build), serves it with `next start`, and checks every public
// page's server HTML the way a crawler sees it (no JavaScript):
//   indexable pages: 200, exactly one H1, a unique title containing "Cordia Classroom", a meta
//   description of 120–160 characters, a canonical equal to SITE_URL + path, JSON-LD that
//   parses, FAQ JSON-LD text equal to the visible FAQ text, and none of the banned words
//   ("unlimited", "CordiaClassroom", "SmartNotes") in the visible text of any public page;
//   noindex pages (/login, /signup, /reset-password): 200 and a robots noindex tag;
//   no public page sends an X-Robots-Tag header, and a sample of signed-in app routes sends
//   "noindex, nofollow" and renders the matching robots meta tag;
//   draft guides (lib/guides/) 404, /guides says "coming soon" while nothing is published, and
//   no draft's text appears in the browser JavaScript (.next/static).
// Run from the repo root: `npm run seo:check` (or `node web/scripts/seoCheck.mjs --skip-build`
// after `npm run build --prefix web`). Exits non-zero on any failure.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_NAME, SITE_URL } from '../lib/brand.mjs';
import { PUBLIC_PAGES, ROBOTS_NOINDEX } from '../lib/publicPages.mjs';
import { GUIDES, PUBLISHED_GUIDES, guidePath } from '../lib/guides/index.mjs';
import { BODIES } from '../lib/guides/bodies.mjs';
import { parseGuide } from '../lib/guides/markdown.mjs';

// Signed-in app routes that must stay out of search (any id works: the pages are static shells).
export const APP_SAMPLES = ['/dashboard', '/library', '/guide/00000000-0000-4000-8000-000000000000', '/settings', '/learn/00000000-0000-4000-8000-000000000000'];

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

// The first words of each draft's opening, which must never appear in the browser bundle: the
// guide registry is imported by browser code, so a body import there would publish the draft.
export const draftMarker = slug => parseGuide(BODIES[slug])[0].text.split(/\s+/).slice(0, 8).join(' ');
export function draftLeaks(staticDir = join(WEB, '.next', 'static')) {
  const files = readdirSync(staticDir, { recursive: true }).filter(name => String(name).endsWith('.js'));
  const bundle = files.map(name => readFileSync(join(staticDir, String(name)), 'utf8')).join('\n');
  return GUIDES.filter(guide => guide.draft).filter(guide => bundle.includes(draftMarker(guide.slug))).map(guide => guide.slug);
}
const NEXT = join(WEB, 'node_modules', '.bin', 'next');
const PORT = Number(process.env.SEO_CHECK_PORT || 3123);
const BASE = `http://127.0.0.1:${PORT}`;

// One pass over the entities React writes, so "&amp;lt;" stays the text "&lt;".
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code) => {
  const lower = code.toLowerCase();
  if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
  if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
  return NAMED[lower];
});
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)]));
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(match => attrs(match[0]));
// Tags come off until none are left (the same loop as readableText in lib/guideText.mjs).
export function stripTags(html) {
  let text = html;
  let previous;
  do { previous = text; text = text.replace(/<[^<>]*>/g, ''); } while (text !== previous);
  return text;
}
const texts = (html, pattern) => [...html.matchAll(pattern)].map(match => decode(stripTags(match[1])).trim());

// The text a visitor sees in <body>: tag by tag, skipping what browsers don't show (scripts,
// styles, templates, noscript).
const HIDDEN = new Set(['script', 'style', 'template', 'noscript']);
export function visibleText(html) {
  const body = html.slice(Math.max(0, html.search(/<body[\s>]/i)));
  const parts = [];
  let hidden = 0;
  let last = 0;
  for (const tag of body.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g)) {
    if (!hidden) parts.push(body.slice(last, tag.index));
    last = tag.index + tag[0].length;
    if (HIDDEN.has(tag[2].toLowerCase())) hidden = Math.max(0, hidden + (tag[1] ? -1 : 1));
  }
  if (!hidden) parts.push(body.slice(last));
  return decode(parts.join(' ')).replace(/\s+/g, ' ').trim();
}

// Words public pages must never show (copy rules: no open-ended limits, the brand is two words,
// the notes feature is "Notes").
export const BANNED = [/unlimited/i, /CordiaClassroom/, /SmartNotes?/i];

// What a crawler reads from one page's HTML.
export function readPage(html) {
  const metas = tags(html, 'meta');
  const jsonld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  return {
    titles: texts(html, /<title[^>]*>([\s\S]*?)<\/title>/gi),
    description: metas.find(meta => meta.name === 'description')?.content,
    robots: metas.find(meta => meta.name === 'robots')?.content || '',
    canonical: tags(html, 'link').find(link => link.rel === 'canonical')?.href,
    h1: (html.match(/<h1[\s>]/gi) || []).length,
    jsonld,
    faq: {
      questions: texts(html, /data-faq-question=""[^>]*>([\s\S]*?)<\/h\d>/gi),
      answers: texts(html, /data-faq-answer=""[^>]*>([\s\S]*?)<\/p>/gi),
    },
  };
}

// Problems with one page, as sentences.
export function checkPage(page, html, status, robotsHeader = null) {
  const problems = [];
  const seen = readPage(html);
  if (status !== 200) problems.push(`status ${status}`);
  if (robotsHeader) problems.push(`X-Robots-Tag: ${robotsHeader}`);
  const text = visibleText(html);
  for (const word of BANNED) if (word.test(text)) problems.push(`shows ${word}`);
  if (!page.index) {
    if (!/noindex/.test(seen.robots)) problems.push('no robots noindex');
    return { problems, seen };
  }
  if (seen.h1 !== 1) problems.push(`${seen.h1} H1s`);
  if (seen.titles.length !== 1 || !seen.titles[0].includes(BRAND_NAME)) problems.push(`title ${JSON.stringify(seen.titles)}`);
  const length = seen.description?.length || 0;
  if (length < 120 || length > 160) problems.push(`description is ${length} characters`);
  const want = SITE_URL + (page.path === '/' ? '/' : page.path);
  if (seen.canonical !== want) problems.push(`canonical ${seen.canonical} (want ${want})`);
  const nodes = [];
  for (const block of seen.jsonld) {
    try {
      const data = JSON.parse(block);
      nodes.push(...(data['@graph'] || [data]));
    } catch (error) {
      problems.push(`JSON-LD doesn't parse: ${error.message}`);
    }
  }
  if (!seen.jsonld.length) problems.push('no JSON-LD');
  const faq = nodes.find(node => node['@type'] === 'FAQPage');
  const visible = seen.faq.questions.map((question, index) => ({ question, answer: seen.faq.answers[index] }));
  const marked = (faq?.mainEntity || []).map(item => ({ question: item.name, answer: item.acceptedAnswer?.text }));
  if (JSON.stringify(visible) !== JSON.stringify(marked)) problems.push('FAQ JSON-LD differs from the visible FAQ');
  return { problems, seen, nodes };
}

async function waitForServer(server) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('next start exited');
    try {
      await fetch(BASE + '/');
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error('next start did not answer');
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    const build = spawnSync(NEXT, ['build'], { cwd: WEB, stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status || 1);
  }
  const server = spawn(NEXT, ['start', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'] });
  let failed = 0;
  try {
    await waitForServer(server);
    const titles = new Map();
    for (const page of PUBLIC_PAGES) {
      const response = await fetch(BASE + page.path, { redirect: 'manual' });
      const { problems, seen, nodes = [] } = checkPage(page, await response.text(), response.status, response.headers.get('x-robots-tag'));
      for (const title of seen.titles) {
        if (titles.has(title)) problems.push(`title also used by ${titles.get(title)}`);
        titles.set(title, page.path);
      }
      if (problems.length) failed++;
      const types = nodes.map(node => node['@type']).join(', ');
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${page.path}${page.index ? '' : ' (noindex)'}  ${seen.titles[0] || ''}${types ? `  [${types}]` : ''}`);
      for (const problem of problems) console.log(`       - ${problem}`);
    }
    for (const path of APP_SAMPLES) {
      const response = await fetch(BASE + path, { redirect: 'manual' });
      const header = response.headers.get('x-robots-tag');
      const meta = readPage(await response.text()).robots;
      const ok = header === ROBOTS_NOINDEX && meta === ROBOTS_NOINDEX;
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${path} (app)  X-Robots-Tag: ${header || 'none'}  robots meta: ${meta || 'none'}`);
    }
    // Drafts: not built for production, so they 404; the index lists none of them.
    for (const guide of GUIDES.filter(item => item.draft)) {
      const response = await fetch(BASE + guidePath(guide), { redirect: 'manual' });
      const ok = response.status === 404;
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${guidePath(guide)} (draft)  ${response.status}`);
    }
    const index = await (await fetch(BASE + '/guides')).text();
    const soon = index.includes('Guides are coming soon');
    const indexOk = PUBLISHED_GUIDES.length ? !soon : soon;
    if (!indexOk) failed++;
    console.log(`${indexOk ? 'ok  ' : 'FAIL'} /guides  ${PUBLISHED_GUIDES.length} published${soon ? ', says coming soon' : ''}`);
    const leaks = draftLeaks();
    if (leaks.length) failed++;
    console.log(`${leaks.length ? 'FAIL' : 'ok  '} draft text in browser JavaScript: ${leaks.length ? leaks.join(', ') : 'none'}`);
    for (const file of ['/robots.txt', '/sitemap.xml', '/llms.txt']) {
      const response = await fetch(BASE + file);
      const ok = response.status === 200 && (await response.text()).length > 0;
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}  ${response.status}`);
    }
  } finally {
    server.kill();
  }
  console.log(failed ? `\n${failed} problem page(s)` : '\nEvery public page passed.');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
