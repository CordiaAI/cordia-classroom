// The AEO foundation: brand facts, the public page list, JSON-LD and the crawl files.
// (tests/test_billing_contract.py checks PLANS against the backend; scripts/seoCheck.mjs checks
// the built pages themselves.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BRAND_NAME, ENTITY_LINE, FREE_PLAN_TEXT, PLANS, SAME_AS, SITE_URL, SUPPORT_EMAIL } from '../lib/brand.mjs';
import { INDEXABLE_PAGES, PUBLIC_PAGES, ROBOTS_NOINDEX, isAppRoute, pageTitle } from '../lib/publicPages.mjs';
import { createRequire } from 'node:module';
import { faqPage, graphJson, homeGraph, ids, pageGraph } from '../lib/structuredData.mjs';
import { ANSWER_ENGINES, lastModified, llmsTxt, robotsTxt, sitemapXml } from '../scripts/crawlFiles.mjs';
import { BANNED, checkPage, decode, readPage, stripTags, visibleText } from '../scripts/seoCheck.mjs';

const FORBIDDEN = [/unlimited/i, /\$29/, /per semester/i, /pro trial/i];

test('brand facts', () => {
  assert.equal(BRAND_NAME, 'Cordia Classroom');
  assert.equal(SITE_URL, 'https://classroom.cordiaai.io');
  assert.equal(SUPPORT_EMAIL, 'support@cordiaai.io');
  assert.match(ENTITY_LINE, /^Cordia Classroom is an AI study app for college students/);
  assert.deepEqual(SAME_AS, ['https://chromewebstore.google.com/detail/cordiaclassroom/eddmfjcnfjfbaknmeccjbjdgpeipjbaf']);
  assert.deepEqual(PLANS.tiers.map(tier => [tier.name, tier.price, tier.interval]), [['Free', '0', 'month'], ['Pro', '4.99', 'month'], ['Academic Weapon', '9.99', 'month']]);
  assert.match(FREE_PLAN_TEXT, /^3 study guides, 10 tutor prompts, 5 Explain views, .* each month, plus one try each of practice sets/);
});

test('every public page has a unique, short, branded title and a 120–160 character description', () => {
  const titles = PUBLIC_PAGES.map(pageTitle);
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(new Set(PUBLIC_PAGES.map(page => page.description)).size, PUBLIC_PAGES.length);
  for (const page of PUBLIC_PAGES) {
    const title = pageTitle(page);
    assert.match(title, / \| Cordia Classroom$/, title);
    assert.ok(title.length <= 60, `${title} is ${title.length} characters`);
    assert.ok(page.description.length >= 120 && page.description.length <= 160, `${page.path}: ${page.description.length}`);
    for (const word of FORBIDDEN) assert.doesNotMatch(page.description, word);
  }
  assert.deepEqual(PUBLIC_PAGES.filter(page => !page.index).map(page => page.path), ['/login', '/signup', '/reset-password']);
  assert.ok(!INDEXABLE_PAGES.some(page => ['/login', '/signup'].includes(page.path)));
});

test('home graph: site, organization and app with one offer per plan, no ratings', () => {
  const graph = homeGraph();
  assert.deepEqual(graph.map(node => node['@type']), ['WebSite', 'Organization', 'WebApplication']);
  const [site, org, app] = graph;
  assert.equal(site['@id'], `${SITE_URL}/#website`);
  assert.deepEqual(site.publisher, { '@id': ids.org });
  assert.equal(org.logo, `${SITE_URL}/cordia-classroom-icon.png`);
  assert.equal(org.email, SUPPORT_EMAIL);
  assert.equal(org.description, ENTITY_LINE);
  assert.ok(!org.sameAs.some(url => /linkedin/i.test(url)));
  assert.deepEqual(org.parentOrganization, { '@type': 'Organization', '@id': 'https://cordiaai.io/#org', name: 'CordiaAI', url: 'https://cordiaai.io' });
  assert.equal(app.applicationCategory, 'EducationalApplication');
  assert.equal(app.operatingSystem, 'Web browser; Chrome extension');
  assert.deepEqual(app.offers.map(offer => [offer.name, offer.price, offer.priceCurrency]), [['Free', '0', 'USD'], ['Pro', '4.99', 'USD'], ['Academic Weapon', '9.99', 'USD']]);
  assert.equal(app.offers[0].priceSpecification, undefined);
  for (const offer of app.offers.slice(1)) {
    assert.equal(offer.priceSpecification['@type'], 'UnitPriceSpecification');
    assert.equal(offer.priceSpecification.unitCode, 'MON');
  }
  assert.doesNotMatch(JSON.stringify(graph), /aggregateRating|"review"/);
});

test('other pages: WebPage inside the site plus a breadcrumb; FAQ markup mirrors the array', () => {
  const [page, crumbs] = pageGraph({ path: '/pricing', name: 'Pricing | Cordia Classroom', crumb: 'Pricing' });
  assert.equal(page['@type'], 'WebPage');
  assert.equal(page.url, `${SITE_URL}/pricing`);
  assert.deepEqual(page.isPartOf, { '@id': ids.website });
  assert.deepEqual(page.about, { '@id': ids.app });
  assert.deepEqual(crumbs.itemListElement.map(item => item.item), [`${SITE_URL}/`, `${SITE_URL}/pricing`]);
  const items = [{ question: 'Q?', answer: 'A.' }];
  assert.deepEqual(faqPage(items, '/pricing').mainEntity, [{ '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } }]);
  assert.doesNotMatch(graphJson([{ name: '</script>' }]), /<\/script>/);
});

test('robots.txt names the answer engines, disallows only /api/ and points to the sitemap', () => {
  const robots = robotsTxt();
  for (const agent of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'Applebot']) {
    assert.ok(ANSWER_ENGINES.includes(agent));
    assert.match(robots, new RegExp(`^User-agent: ${agent}$`, 'm'));
  }
  assert.deepEqual(robots.match(/^Disallow: .*$/gm), ['Disallow: /api/', 'Disallow: /api/']);
  assert.match(robots, /^Sitemap: https:\/\/classroom\.cordiaai\.io\/sitemap\.xml$/m);
});

test('sitemap lists only indexable pages, dated by their last commit or the build date', () => {
  const xml = sitemapXml();
  for (const page of INDEXABLE_PAGES) assert.ok(xml.includes(`<loc>${SITE_URL}${page.path === '/' ? '/' : page.path}</loc>`), page.path);
  assert.doesNotMatch(xml, /\/login<|\/signup<|\/reset-password</);
  assert.match(lastModified('pages/pricing.js'), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(lastModified('pages/pricing.js', { git: false, today: new Date('2026-01-02T10:00:00Z') }), '2026-01-02');
});

test('llms.txt: facts only, from the brand module', () => {
  const text = llmsTxt();
  assert.ok(text.startsWith('# Cordia Classroom\n\n> ' + ENTITY_LINE + '\n'));
  assert.match(text, /- Pro: \$4\.99 a month/);
  assert.match(text, /- Academic Weapon: \$9\.99 a month/);
  assert.match(text, /Free trial: 7 days of Academic Weapon, no card needed, one per account/);
  assert.ok(text.includes(SUPPORT_EMAIL));
  for (const page of INDEXABLE_PAGES) assert.ok(text.includes(`(${SITE_URL}${page.path === '/' ? '/' : page.path})`), page.path);
  for (const word of FORBIDDEN) assert.doesNotMatch(text, word);
});

test('the SEO check reads text the way a crawler does', () => {
  assert.equal(stripTags('a<<b>i>b'), 'ab');
  assert.equal(stripTags('<<b>script>x'), 'x');
  assert.equal(decode('A &amp;lt;b&amp;gt; &#x27;c&#39;'), "A &lt;b&gt; 'c'");
  const page = readPage('<title>T | Cordia Classroom</title><h1>One</h1><section data-faq=""><h3 class="x" data-faq-question="">Q &amp; A?</h3><p data-faq-answer="">Yes, <b>it</b> is.</p></section>');
  assert.deepEqual(page.titles, ['T | Cordia Classroom']);
  assert.equal(page.h1, 1);
  assert.deepEqual(page.faq, { questions: ['Q & A?'], answers: ['Yes, it is.'] });
});

test('the SEO check reads only visible body text and flags the banned words', () => {
  const html = '<html><head><title>CordiaClassroom</title></head><body><h1>Cordia Classroom</h1><script>var unlimited = 1;</script><style>.SmartNotes{}</style><p>Notes &amp; flashcards</p><script type="application/ld+json">{"name":"SmartNotes"}</script></body></html>';
  assert.equal(visibleText(html), 'Cordia Classroom Notes & flashcards');
  assert.ok(!BANNED.some(word => word.test(visibleText(html))));
  for (const text of ['Unlimited guides', 'Open CordiaClassroom', 'Your SmartNotes', 'A SmartNote']) {
    assert.ok(BANNED.some(word => word.test(text)), text);
  }
  const page = { path: '/login', index: false };
  const { problems } = checkPage(page, '<head><meta name="robots" content="noindex"/></head><body><p>Unlimited</p></body>', 200);
  assert.deepEqual(problems, ['shows /unlimited/i']);
});

test('user-facing text names the product "Cordia Classroom", in the app tabs and the extension', async () => {
  const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
  assert.match(await read('web/lib/pageTitle.js'), /export const BRAND = 'Cordia Classroom';/);
  const manifest = JSON.parse(await read('extension/manifest.json'));
  assert.equal(manifest.name, 'Cordia Classroom');
  assert.ok(manifest.description.length < 132);
  assert.equal(manifest.commands._execute_action.description, 'Open the Cordia Classroom side panel');
  for (const path of ['extension/popup.html', 'extension/popup.js', 'extension/background.js', 'extension/README.md', 'extension/store-listing.md', 'web/lib/guideCreate.js', 'web/components/AcademicInfinityMark.js']) {
    assert.doesNotMatch(await read(path), /CordiaClassroom/, path);
  }
});

test('every route outside the public pages is noindex, except routes with their own rules', async () => {
  const rules = await createRequire(import.meta.url)('../next.config.js').headers();
  const rule = rules.find(r => r.headers.some(h => h.key === 'X-Robots-Tag'));
  assert.deepEqual(rule.headers, [{ key: 'X-Robots-Tag', value: ROBOTS_NOINDEX }]);
  assert.equal(ROBOTS_NOINDEX, 'noindex, nofollow');
  const noindex = path => new RegExp(`^${rule.source}$`).test(path);
  for (const page of PUBLIC_PAGES) {
    assert.ok(!noindex(page.path), page.path);
    assert.ok(!isAppRoute(page.path), page.path);
  }
  for (const path of ['/dashboard', '/library', '/guide/abc', '/settings', '/settings/privacy', '/learn/abc', '/assistant', '/404', '/oauth/consent', '/auth/callback']) {
    assert.ok(noindex(path), path);
  }
  for (const route of ['/dashboard', '/guide/[id]', '/learn/[guideId]', '/settings', '/404', '/assistant']) assert.ok(isAppRoute(route), route);
  // Shared guides and invites set their own noindex; profiles, Discover and the Assistant app are unchanged.
  for (const path of ['/sets/abc', '/join/abc', '/u/someone', '/explore', '/assistant/privacy']) assert.ok(!noindex(path), path);
  for (const route of ['/sets/[id]', '/join/[token]', '/u/[username]', '/explore']) assert.ok(!isAppRoute(route), route);
  // Files keep serving without the header: the crawl files, images and Next's assets.
  for (const path of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/og-image.png', '/_next/static/chunks/a.js']) assert.ok(!noindex(path), path);
});
