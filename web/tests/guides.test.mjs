// Guides (/guides): content files, the draft rule, the Markdown subset, Article markup and the
// rules every draft follows. scripts/seoCheck.mjs checks the built site (drafts 404, no draft text
// in browser JavaScript).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AUTHOR, GUIDES, PUBLISHED_GUIDES, draftsVisible, guideBySlug, guidePath, visibleGuides } from '../lib/guides/index.mjs';
import { BODIES } from '../lib/guides/bodies.mjs';
import { editorNotes, guideWords, inline, parseGuide } from '../lib/guides/markdown.mjs';
import { relatedLinks } from '../lib/guides/related.mjs';
import { PUBLIC_PAGES, isAppRoute, pageTitle, publicPage } from '../lib/publicPages.mjs';
import { articleGraph } from '../lib/structuredData.mjs';
import { llmsTxt, sitemapXml } from '../scripts/crawlFiles.mjs';
import { USE_CASES, useCasePath } from '../lib/useCases/index.mjs';

const WORDS = {
  'how-to-study-for-finals': [1500, 2000],
  'ai-study-help-college': [2500, 3500],
  'source-grounded-ai-tutoring': [1200, 1600],
  'are-ai-tutors-safe-for-students': [1200, 1600],
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const sitePaths = new Set([...USE_CASES.map(useCasePath), ...GUIDES.map(guidePath), '/privacy', '/honor-code', '/instructors', '/pricing']);

test('the Markdown subset: headings, paragraphs, lists, tables, links, bold; comments never render', () => {
  const text = 'Opening line one.\nstill the opening.\n\n<!-- note one -->\n## A question?\n- item [a link](/pricing)\n- **bold** item\n\n<!--\nmulti\nline -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nInline <!-- hidden --> text.';
  const blocks = parseGuide(text);
  assert.deepEqual(blocks.map(block => block.type), ['p', 'h2', 'ul', 'table', 'p']);
  assert.equal(blocks[0].text, 'Opening line one. still the opening.');
  assert.deepEqual(blocks[3], { type: 'table', head: ['A', 'B'], rows: [['1', '2']] });
  assert.equal(blocks[4].text, 'Inline  text.');
  assert.ok(!JSON.stringify(blocks).includes('note one') && !JSON.stringify(blocks).includes('multi'));
  assert.deepEqual(editorNotes(text), ['note one', 'multi\nline', 'hidden']);
  assert.deepEqual(inline('See [this](https://example.org) and **that**.'), [{ text: 'See ' }, { link: 'this', href: 'https://example.org' }, { text: ' and ' }, { bold: 'that' }, { text: '.' }]);
  assert.throws(() => parseGuide('| A |\n| B |'), /needs a \| --- \| row/);
});

test('drafts are visible only in dev and on Vercel previews', () => {
  assert.equal(draftsVisible({ NODE_ENV: 'development' }), true);
  assert.equal(draftsVisible({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }), true);
  assert.equal(draftsVisible({ NODE_ENV: 'production', VERCEL_ENV: 'production' }), false);
  assert.equal(draftsVisible({ NODE_ENV: 'production' }), false);
  const drafts = GUIDES.filter(guide => guide.draft);
  assert.deepEqual(visibleGuides({ NODE_ENV: 'production' }), PUBLISHED_GUIDES);
  assert.equal(visibleGuides({ VERCEL_ENV: 'preview' }).length, GUIDES.length);
  assert.deepEqual(drafts, [], 'the four guides are published (the owner added the personal examples)');
});

test('drafts stay out of the page list, sitemap and llms.txt, and get the app noindex rule', () => {
  for (const guide of GUIDES.filter(item => item.draft)) {
    const path = guidePath(guide);
    assert.equal(publicPage(path), undefined, path);
    assert.equal(isAppRoute(path), true, `${path} must be noindexed`);
    assert.ok(!sitemapXml().includes(path) && !llmsTxt().includes(path), `${path} leaked into a crawl file`);
  }
  const index = publicPage('/guides');
  assert.ok(index, '/guides is a public page');
  assert.equal(index.index, PUBLISHED_GUIDES.length > 0, '/guides stays noindex until a guide is published');
  for (const guide of PUBLISHED_GUIDES) {
    const path = guidePath(guide);
    assert.equal(publicPage(path)?.index, true, path);
    assert.equal(isAppRoute(path), false, `${path} must not get the app noindex rule`);
    assert.ok(sitemapXml().includes(`/guides/${guide.slug}<`) && llmsTxt().includes(path), `${path} is missing from a crawl file`);
  }
  if (PUBLISHED_GUIDES.length) assert.ok(sitemapXml().includes('/guides<') && llmsTxt().includes('/guides'), '/guides is in the crawl files');
});

test('publishing a guide (flipping the flag) registers it as an Article page', async () => {
  const guide = { ...GUIDES[0], draft: false };
  const entry = { path: guidePath(guide), topic: guide.topic, description: guide.description, crumb: guide.crumb, modified: guide.dateModified, article: { headline: guide.title, author: AUTHOR, published: guide.datePublished } };
  const [article, crumbs] = articleGraph({ path: entry.path, description: entry.description, crumb: entry.crumb, modified: entry.modified, ...entry.article });
  assert.equal(article['@type'], 'Article');
  assert.equal(article.headline, guide.title);
  assert.deepEqual(article.author, { '@type': 'Person', name: 'Jude Moore', description: AUTHOR.role });
  assert.equal(article.publisher['@id'], 'https://classroom.cordiaai.io/#org');
  assert.equal(article.mainEntityOfPage['@id'], `https://classroom.cordiaai.io${entry.path}`);
  assert.ok(ISO.test(article.datePublished) && ISO.test(article.dateModified));
  assert.deepEqual(crumbs.itemListElement.map(item => item.name), ['Home', 'Guides', guide.crumb]);
  const pages = await readFile(new URL('../lib/publicPages.mjs', import.meta.url), 'utf8');
  assert.match(pages, /\.\.\.PUBLISHED_GUIDES\.map\(guide => \(\{/);
  assert.ok(pageTitle(entry).length <= 60);
});

test('every guide content file has the fields and follows the article rules', () => {
  assert.deepEqual(Object.keys(BODIES).sort(), GUIDES.map(guide => guide.slug).sort());
  for (const guide of GUIDES) {
    const body = BODIES[guide.slug];
    assert.equal(guideBySlug(guide.slug), guide);
    assert.match(guide.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(guide.title && guide.topic && guide.crumb, guide.slug);
    assert.ok(pageTitle(guide).length <= 60, `${guide.slug} title is too long`);
    assert.ok(guide.description.length >= 120 && guide.description.length <= 160, `${guide.slug}: ${guide.description.length}`);
    assert.deepEqual(guide.author, AUTHOR);
    assert.ok(ISO.test(guide.datePublished) && ISO.test(guide.dateModified) && guide.dateModified >= guide.datePublished);
    assert.equal(typeof guide.draft, 'boolean');
    const blocks = parseGuide(body);
    assert.equal(blocks[0].type, 'p', `${guide.slug} opens with its answer`);
    assert.ok(blocks[0].text.split(/(?<=[.!?])\s+/).length >= 2, `${guide.slug}: the opening is two sentences or more`);
    assert.ok(!/^# /m.test(body), 'the H1 comes from the title, not the body');
    for (const heading of blocks.filter(block => block.type === 'h2')) assert.match(heading.text, /\?$/, `${guide.slug}: "${heading.text}" is a question`);
    const [low, high] = WORDS[guide.slug];
    const words = guideWords(body);
    assert.ok(words >= low && words <= high, `${guide.slug}: ${words} words (want ${low}–${high})`);
    // A published guide has its personal examples filled in, so no editor notes are left.
    if (!guide.draft) assert.deepEqual(editorNotes(body), [], `${guide.slug} still has editor notes`);
    // Every outside link in the body is listed under Sources; every site link goes to a real page.
    const sourceUrls = new Set(guide.sources.map(source => source.url));
    for (const source of guide.sources) assert.ok(source.url.startsWith('https://') && source.title && source.supports, source.url);
    for (const [, href] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (href.startsWith('/')) assert.ok(sitePaths.has(href), `${guide.slug} links to ${href}`);
      else assert.ok(sourceUrls.has(href), `${guide.slug} cites ${href} without listing it under Sources`);
    }
    for (const href of guide.related) assert.ok(sitePaths.has(href), `${guide.slug} relates ${href}`);
    assert.doesNotMatch(body, /unlimited|CordiaClassroom|SmartNotes/);
  }
});

test('the pillar links every use-case page and every other guide', () => {
  const body = BODIES['ai-study-help-college'];
  for (const path of [...USE_CASES.map(useCasePath), ...GUIDES.filter(guide => guide.slug !== 'ai-study-help-college').map(guidePath)]) {
    assert.ok(body.includes(`](${path})`), `pillar is missing ${path}`);
  }
});

test('related links never point a build at a guide it does not show', () => {
  const draft = { ...GUIDES[0], draft: true };
  const shown = relatedLinks([useCasePath(USE_CASES[0]), guidePath(draft)], []);
  assert.deepEqual(shown.map(item => item.href), [useCasePath(USE_CASES[0])]);
  assert.deepEqual(relatedLinks([guidePath(draft)], [draft]), [{ href: guidePath(draft), label: draft.title }]);
});

test('browser code never imports guide bodies', async () => {
  for (const file of ['lib/guides/index.mjs', 'lib/publicPages.mjs', 'components/GuideArticle.js', 'components/PublicPage.js', 'pages/guides/index.js']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^import[^;]*(\bbody\b|bodies\.mjs)/m, file);
  }
  const page = await readFile(new URL('../pages/guides/[slug].js', import.meta.url), 'utf8');
  assert.match(page, /export function getStaticProps/);
  assert.match(page, /fallback: false/);
});

test('the public frame and noindex rule treat /guides as public', async () => {
  const app = await readFile(new URL('../pages/_app.js', import.meta.url), 'utf8');
  assert.match(app, /router\.pathname === '\/guides' \|\| router\.pathname === '\/guides\/\[slug\]'/);
  assert.match(app, /isAppRoute\(routePath\)/);
  assert.ok(PUBLIC_PAGES.some(page => page.path === '/guides'));
});
