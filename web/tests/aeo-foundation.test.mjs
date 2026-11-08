// The AEO foundation: brand facts, the public page list, JSON-LD and the crawl files.
// (tests/test_billing_contract.py checks PLANS against the backend; scripts/seoCheck.mjs checks
// the built pages themselves.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_NAME, ENTITY_LINE, FREE_PLAN_TEXT, PLANS, SAME_AS, SITE_URL, SUPPORT_EMAIL } from '../lib/brand.mjs';
import { INDEXABLE_PAGES, PUBLIC_PAGES, pageTitle } from '../lib/publicPages.mjs';
import { faqPage, graphJson, homeGraph, ids, pageGraph } from '../lib/structuredData.mjs';
import { ANSWER_ENGINES, lastModified, llmsTxt, robotsTxt, sitemapXml } from '../scripts/crawlFiles.mjs';

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

test('robots.txt names the answer engines, disallows nothing and points to the sitemap', () => {
  const robots = robotsTxt();
  for (const agent of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'Applebot']) {
    assert.ok(ANSWER_ENGINES.includes(agent));
    assert.match(robots, new RegExp(`^User-agent: ${agent}$`, 'm'));
  }
  assert.doesNotMatch(robots, /Disallow/);
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
