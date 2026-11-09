// /best-ai-study-platforms-canvas-integration: text from web/content/<slug>.md, JSON-LD from
// web/content/<slug>.jsonld.json (lib/comparisons/). scripts/seoCheck.mjs checks the built page too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { COMPARISONS, comparisonPath } from '../lib/comparisons/index.mjs';
import { parseComparison } from '../lib/comparisons/markdown.mjs';
import { INDEXABLE_PAGES, pageTitle, publicPage } from '../lib/publicPages.mjs';
import { sitemapXml } from '../scripts/crawlFiles.mjs';

const SLUG = 'best-ai-study-platforms-canvas-integration';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const markdown = await read(`../content/${SLUG}.md`);
const jsonLd = JSON.parse(await read(`../content/${SLUG}.jsonld.json`));
const parts = parseComparison(markdown);
const page = COMPARISONS.find(item => item.slug === SLUG);
const blocks = [...parts.before, ...parts.faqAfter, ...parts.after];

test('the visible FAQ and the FAQPage JSON-LD say the same thing, word for word', () => {
  const marked = jsonLd['@graph'].find(node => node['@type'] === 'FAQPage').mainEntity
    .map(item => ({ question: item.name, answer: item.acceptedAnswer.text }));
  assert.equal(parts.faq.length, 7);
  assert.deepEqual(parts.faq, marked);
  for (const item of parts.faq) assert.doesNotMatch(item.answer, /\]\(|https?:\/\//, `no link inside "${item.question}"`);
});

test('the comparison table shows the price cells exactly as written', () => {
  const table = blocks.find(block => block.type === 'table');
  assert.deepEqual(table.head, ['Tool', 'How it connects to Canvas', 'What it makes', 'Uses your own materials', 'Free tier', 'Price']);
  assert.deepEqual(table.rows.map(row => [row[0], row[5]]), [
    ['Cordia Classroom', 'Pro $4.99/month; Academic Weapon $9.99/month'],
    ['StudyFetch', 'No pricing page linked from their site'],
    ['Quizlet', 'See their pricing page'],
    ['Knowt', '$149.99/year or $24.99/month'],
    ['Gemini Notebook', 'See their plans page'],
    ['ChatGPT', 'See their pricing page'],
    ['Claude', 'Pro $20/month or $17/month billed yearly'],
  ]);
  assert.doesNotMatch(markdown, /semester|\b15 (study )?guides|\b100 (study )?guides/i, 'only the live pricing page\'s numbers');
});

test('every walkthrough screenshot is in public/images/canvas-comparison with its alt text and size', async () => {
  const steps = blocks.find(block => block.type === 'ol' && block.items.length === 6);
  const images = steps.items.flatMap(item => item.images);
  assert.equal(images.length, 6);
  for (const image of images) {
    assert.match(image.src, /^\/images\/canvas-comparison\/0\d-[a-z-]+\.png$/);
    assert.ok((await stat(new URL(`../public${image.src}`, import.meta.url))).size > 0, image.src);
    assert.ok(image.alt.length > 20, `${image.src} has alt text`);
    assert.ok(page.images[image.src], `${image.src} has a width and height`);
  }
});

test('internal links from the brief: on the page, below the FAQ, and pointing here', async () => {
  assert.match(markdown, /\n\[Studying with Canvas in Cordia\]\(\/canvas-study-tool\)\n/);
  assert.match(markdown, /\n {3}\[Get the Chrome extension\]\(\/install-extension\)\n/);
  assert.deepEqual(parts.faqAfter, [{ type: 'ul', items: ["[Cordia's Honor Code](/honor-code)", '[Cordia pricing](/pricing)'] }]);
  assert.match(await read('../components/PublicPage.js'), /COMPARISONS\.map\(page => <Link key=\{page\.slug\} href=\{comparisonPath\(page\)\}>\{page\.footerLabel\}<\/Link>\)/);
  assert.equal(page.footerLabel, 'AI study platforms with Canvas integration');
  assert.match(await read('../lib/useCases/installExtension.mjs'), /href: '\/best-ai-study-platforms-canvas-integration', label: 'See which AI study tools work with Canvas'/);
  assert.match(await read('../lib/useCases/aiQuizGenerator.mjs'), /href: '\/best-ai-study-platforms-canvas-integration', label: 'AI study platforms compared'/);
});

test('head: the exact title, description and dates, and the page is indexed and in the sitemap', async () => {
  const entry = publicPage(comparisonPath(page));
  assert.equal(pageTitle(entry), 'Best AI Study Platforms With Canvas Integration (2026)');
  assert.equal(entry.description, 'Compare AI study platforms that work with Canvas: how each one connects, what it makes from your class materials, free tiers and prices.');
  assert.equal(page.ogTitle, 'Best AI Study Platforms With Canvas Integration');
  assert.deepEqual([page.published, page.modified], ['2026-11-09', '2026-11-09']);
  assert.ok(INDEXABLE_PAGES.includes(entry));
  assert.match(sitemapXml({ git: false, today: new Date('2026-11-09T12:00:00Z') }), /<loc>https:\/\/classroom\.cordiaai\.io\/best-ai-study-platforms-canvas-integration<\/loc><lastmod>2026-11-09<\/lastmod>/);
  const head = await read('../components/SeoHead.js');
  for (const tag of ['og:image:width', 'article:published_time', 'article:modified_time', 'twitter:card']) assert.ok(head.includes(`"${tag}"`), tag);
  assert.equal(parts.h1, 'Best AI Study Platforms With Canvas Integration');
});
