// Use-case pages: one content file each (lib/useCases/), laid out by components/UseCasePage.js and
// registered in the public pages list. scripts/seoCheck.mjs checks the built pages themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { PLAN_LINE, PLANS, freeAllowance, planByKey } from '../lib/brand.mjs';
import { INDEXABLE_PAGES, PUBLIC_PAGES, isAppRoute, pageTitle } from '../lib/publicPages.mjs';
import { pageGraph } from '../lib/structuredData.mjs';
import { llmsTxt, sitemapXml } from '../scripts/crawlFiles.mjs';
import { USE_CASES, useCaseBySlug, useCasePath } from '../lib/useCases/index.mjs';

const FORBIDDEN = [/unlimited/i, /\$29/, /per semester/i, /pro trial/i, /testimonial/i];
const web = new URL('../', import.meta.url);
const sentences = text => text.split(/(?<=[.!?])\s+/).filter(Boolean);
const allText = page => [
  page.h1, ...page.lede, ...page.steps, ...page.scenarios,
  ...page.screenshots.flatMap(shot => [shot.alt, shot.caption]),
  ...page.sections.flatMap(section => [section.question, section.answer, ...(section.paragraphs || []), ...(section.bullets || [])]),
  ...page.faq.flatMap(item => [item.question, item.answer]),
].join('\n');

test('every use-case page is registered as an indexable public page', () => {
  assert.ok(USE_CASES.length >= 1);
  assert.equal(new Set(USE_CASES.map(page => page.slug)).size, USE_CASES.length);
  for (const page of USE_CASES) {
    const path = useCasePath(page);
    assert.equal(useCaseBySlug(page.slug), page);
    const entry = PUBLIC_PAGES.find(item => item.path === path);
    assert.ok(entry, `${path} is missing from PUBLIC_PAGES`);
    assert.equal(entry.file, `pages/${page.slug}.js`);
    assert.equal(entry.index, true);
    assert.equal(entry.modified, page.updated);
    assert.ok(INDEXABLE_PAGES.includes(entry));
    assert.equal(isAppRoute(path), false, `${path} must not get the app noindex header`);
    assert.ok(pageTitle(entry).length <= 60, pageTitle(entry));
    assert.ok(sitemapXml().includes(`/${page.slug}</loc>`), `${path} missing from the sitemap`);
    assert.ok(llmsTxt().includes(`/${page.slug})`), `${path} missing from llms.txt`);
  }
});

test('every use-case content file follows the layout rules', async () => {
  for (const page of USE_CASES) {
    assert.match(page.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.match(page.updated, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(page.h1, / with Cordia Classroom$/);
    assert.equal(page.lede.length, 2, 'two-sentence opening');
    for (const sentence of page.lede) assert.equal(sentences(sentence).length, 1, sentence);
    assert.ok(page.steps.length >= 3 && page.steps.length <= 5, 'three to five steps');
    assert.equal(page.scenarios.length, 3, 'three example scenarios');
    assert.ok(page.faq.length >= 5 && page.faq.length <= 7, 'five to seven FAQ entries');
    assert.ok(page.footerLabel);
    for (const section of page.sections) {
      assert.match(section.question, /\?$/, section.question);
      const count = sentences(section.answer).length;
      assert.ok(count >= 1 && count <= 2, `${section.question}: answer is ${count} sentences`);
      assert.ok(section.paragraphs || section.bullets, `${section.question} needs paragraphs or bullets`);
    }
    for (const shot of page.screenshots) {
      assert.match(shot.src, /^\/use-cases\/[a-z0-9-]+\.webp$/);
      assert.ok(shot.width > 0 && shot.height > 0 && shot.alt.length > 30 && shot.caption);
      const file = new URL(`public${shot.src}`, web);
      assert.ok((await stat(file)).size > 0, `${shot.src} is missing`);
      // The width and height in the page must match the file, so the image reserves the right space.
      const bytes = await readFile(file);
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
      const chunk = bytes.toString('ascii', 12, 16);
      const size = chunk === 'VP8X'
        ? [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1] // extended: 24-bit sizes minus one
        : chunk === 'VP8 '
          ? [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff] // lossy key frame header
          : null;
      assert.ok(size, `${shot.src}: unexpected WebP chunk ${chunk}`);
      assert.deepEqual(size, [shot.width, shot.height], `${shot.src} size`);
    }
    for (const word of FORBIDDEN) assert.doesNotMatch(allText(page), word);
  }
});

test('the plan line comes from the plan list', () => {
  const { trial } = PLANS;
  assert.equal(PLAN_LINE, `Free includes ${freeAllowance('guide')} study guides a month. ${planByKey('pro').name} is $${planByKey('pro').price} a month and ${planByKey('weapon').name} is $${planByKey('weapon').price} a month, and new accounts can try ${trial.plan} free for ${trial.days} days with no card.`);
  for (const word of FORBIDDEN) assert.doesNotMatch(PLAN_LINE, word);
});

test('use-case JSON-LD carries dateModified; other pages do not', () => {
  const [webPage] = pageGraph({ path: '/ai-study-guide-generator', name: 'x', crumb: 'AI study guide generator', modified: '2026-11-08' });
  assert.equal(webPage.dateModified, '2026-11-08');
  assert.deepEqual(webPage.isPartOf, { '@id': 'https://classroom.cordiaai.io/#website' });
  assert.deepEqual(webPage.about, { '@id': 'https://classroom.cordiaai.io/#app' });
  assert.equal('dateModified' in pageGraph({ path: '/pricing', name: 'x', crumb: 'Pricing' })[0], false);
});

test('the layout keeps its order, call to action and footer group', async () => {
  const layout = await readFile(new URL('components/UseCasePage.js', web), 'utf8');
  assert.match(layout, /href=\{`\/signup\?from=\$\{page\.slug\}`\}/);
  assert.match(layout, />Make your first study guide free</);
  assert.doesNotMatch(layout, /utm_/);
  assert.match(layout, /faqInPage/);
  const order = ['uc-crumbs', 'uc-title', 'uc-lede', 'uc-how', 'uc-shots', 'page.sections', 'uc-who', 'uc-plan', '<Faq', 'uc-cta', 'uc-meta'];
  const positions = order.map(marker => layout.indexOf(marker));
  assert.ok(positions.every(pos => pos >= 0), `missing: ${order.filter((_, i) => positions[i] < 0)}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'sections are out of order');
  const frame = await readFile(new URL('components/PublicPage.js', web), 'utf8');
  assert.match(frame, /aria-label="Use Cordia for"/);
  for (const page of USE_CASES) {
    const file = await readFile(new URL(`pages/${page.slug}.js`, web), 'utf8');
    assert.match(file, /<UseCasePage page=\{page\} \/>/);
  }
});
