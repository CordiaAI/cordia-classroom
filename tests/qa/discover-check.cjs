// Discover (/explore) in a real browser against a local dev server and the mock API: with sets, an empty
// search (popular and classmates' sets underneath), an empty catalogue, loading, and a failed load, in light
// and dark at 1440x900, 1024x768 and 390x844. Run the app first (classrooms on, for "From your classmates"):
//   NEXT_PUBLIC_CLASSROOMS=1 npm run dev --prefix web -- -p 3121
//   BASE=http://localhost:3121 node tests/qa/discover-check.cjs   (SHOTS=/some/dir saves screenshots; ONLY=regex runs some checks)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER, sampleDiscover } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3121';
const SHOTS = process.env.SHOTS || '';
const SIZES = { desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 768 }, phone: { width: 390, height: 844 } };
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n').slice(0, 3).join(' | ').slice(0, 400)}`); }
}

async function open(browser, { size = 'desktop', theme = 'light', discover, url = '/explore' } = {}) {
  const context = await browser.newContext({ viewport: SIZES[size], colorScheme: theme });
  const state = createState(true);
  state.discover = discover;
  await install(context, state);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, mode]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', mode); }, [TOKEN, USER, theme]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await page.goto(BASE + url); break; } catch (error) { if (attempt === 2) throw error; await page.waitForTimeout(500); }
  }
  await page.waitForSelector('h1.c-title', { timeout: 60000 });
  return { context, page, problems, state };
}

const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const width = (page, selector) => page.locator(selector).first().evaluate(node => Math.round(node.getBoundingClientRect().width));
const mark = page => page.locator('.c-loader');

async function main() {
  const browser = await chromium.launch();
  const data = sampleDiscover();

  for (const theme of ['light', 'dark']) {
    for (const size of Object.keys(SIZES)) {
      const tag = `${theme}-${size}`;

      await check(`${tag}: with sets, Popular public sets heads the list in the shell's column`, async () => {
        const { context, page, problems } = await open(browser, { size, theme, discover: data });
        await page.waitForSelector('.exg-card');
        expect((await page.locator('.exg-card').count()) === 5, 'five sets');
        expect(await page.locator('h2', { hasText: 'Popular public sets' }).count() === 1, 'a Popular public sets heading');
        if (size === 'desktop') expect((await width(page, '.ex')) === (await width(page, '.workspace-route')), `column should fill the shell's, is ${await width(page, '.ex')} of ${await width(page, '.workspace-route')}`);
        expect(await noOverflow(page), 'no sideways scroll');
        await shot(page, `${tag}-sets`);
        expect(problems.length === 0, problems.join(' | '));
        await context.close();
      });

      await check(`${tag}: an empty search says so, offers one action, then shows popular sets and classmates' sets`, async () => {
        const { context, page } = await open(browser, { size, theme, discover: data, url: '/explore?q=zebra' });
        await page.waitForSelector('.dp-empty');
        expect((await page.locator('.dp-empty').innerText()).includes('No public sets match “zebra”.'), 'the sentence');
        expect(await page.locator('.dp-empty .c-btn').count() === 1, 'one action');
        expect((await page.locator('.dp-empty .c-btn').innerText()) === 'Clear search', 'the action');
        await page.waitForSelector('h2:has-text("Popular public sets")');
        await page.waitForSelector('h2:has-text("From your classmates")');
        // The set in both lists shows once, under Popular.
        const titles = await page.locator('.dp-group .exg-title').allInnerTexts();
        expect(new Set(titles).size === titles.length, 'no set twice: ' + titles.join(' | '));
        expect(!/!/.test(await page.locator('.ex-panel').innerText()), 'no exclamation marks');
        expect(await noOverflow(page), 'no sideways scroll');
        await shot(page, `${tag}-empty-search`);
        await page.locator('.dp-empty .c-btn').click();
        await page.waitForSelector('.exg-card');
        expect(page.url().endsWith('/explore'), 'cleared back to /explore: ' + page.url());
        await context.close();
      });

      await check(`${tag}: an empty catalogue has a padded sentence and one action to your library`, async () => {
        const { context, page } = await open(browser, { size, theme, discover: { guides: [], classmates: [], classrooms: [], people: [] } });
        await page.waitForSelector('.dp-empty');
        expect((await page.locator('.dp-empty').innerText()).includes('Sets that students share publicly show up here.'), 'the sentence');
        const link = page.locator('.dp-empty a.c-btn');
        expect((await link.getAttribute('href')) === '/library', 'goes to the library');
        const padding = await page.locator('.dp-empty').evaluate(node => parseFloat(getComputedStyle(node).paddingTop));
        expect(padding >= 36, 'padded, is ' + padding);
        expect(await page.locator('.dp-group').count() === 0, 'nothing to suggest, so nothing shown');
        expect(await page.locator('.exg-filters').count() === 0, 'no filters when there is nothing to filter');
        await shot(page, `${tag}-empty-catalogue`);
        await context.close();
      });

      await check(`${tag}: slow data shows the breathing mark after 200ms, no spinner or skeleton`, async () => {
        const { context, page } = await open(browser, { size, theme, discover: { ...data, delay: 2500 } });
        await page.waitForSelector('.dp-loading');
        expect(await mark(page).count() === 0, 'no mark in the first 200ms');
        await page.waitForSelector('.dp-loading .c-loader', { timeout: 1500 });
        expect(await page.locator('.c-loader-mark').count() === 1, 'the Cordia mark');
        expect(await page.locator('[class*="skeleton"], [class*="spinner"]').count() === 0, 'no skeleton or spinner');
        await shot(page, `${tag}-loading`);
        await page.waitForSelector('.exg-card', { timeout: 8000 });
        await context.close();
      });

      await check(`${tag}: a failed load is a plain sentence and a retry that works`, async () => {
        const { context, page, state } = await open(browser, { size, theme, discover: { ...data, fail: 'guides' } });
        await page.waitForSelector('.dp-empty [role="alert"]');
        expect((await page.locator('.dp-empty').innerText()).includes('Couldn’t load public sets.'), 'the sentence');
        expect(await page.locator('.exg-card').count() === 0, 'no sets');
        await shot(page, `${tag}-error`);
        state.discover.fail = false;
        await page.getByRole('button', { name: 'Try again' }).click();
        await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tabpanel', null, { timeout: 2000 }).catch(() => { throw new Error('focus should stay in the panel, not fall to the page'); });
        await page.waitForSelector('.exg-card');
        await context.close();
      });
    }
  }

  await check('classrooms and people tabs use the same states', async () => {
    const { context, page } = await open(browser, { discover: { ...data, classrooms: [] }, url: '/explore?tab=classrooms' });
    await page.waitForSelector('.dp-empty');
    expect((await page.locator('.dp-empty').innerText()).includes('No public classrooms yet.'), 'classrooms empty sentence');
    await page.getByRole('button', { name: 'Browse public sets' }).click();
    await page.waitForSelector('.exg-card');
    await page.getByRole('tab', { name: 'People' }).click();
    await page.waitForSelector('.dp-empty');
    expect((await page.locator('.dp-empty .c-btn').innerText()) === 'Search people', 'people prompt action');
    await page.locator('.dp-empty .c-btn').click();
    expect(await page.evaluate(() => document.activeElement?.id) === 'ex-q', 'focus moves to the search');
    await page.fill('#ex-q', 'maya');
    await page.waitForSelector('.exp-list');
    await page.fill('#ex-q', 'nobody');
    await page.waitForSelector('.dp-empty:has-text("No public profiles match")');
    await context.close();
  });

  await check('hover changes no colour or weight on the empty state', async () => {
    const { context, page } = await open(browser, { discover: data, url: '/explore?q=zebra' });
    await page.waitForSelector('.dp-empty');
    const style = () => page.locator('.dp-empty-message').evaluate(node => { const s = getComputedStyle(node); return s.color + s.fontWeight; });
    const before = await style();
    await page.locator('.dp-empty').hover();
    expect((await style()) === before, 'message unchanged on hover');
    await context.close();
  });

  await check('the first content stays put from loading to loaded, in every state', async () => {
    const states = [
      ['with sets', data, '/explore'],
      ['empty catalogue', { guides: [], classmates: [], classrooms: [], people: [] }, '/explore'],
      ['empty search', data, '/explore?q=zebra'],
      ['filtered', data, '/explore?school=s1'],
    ];
    for (const size of ['desktop', 'phone']) {
      for (const [name, discover, url] of states) {
        const { context, page } = await open(browser, { size, discover: { ...discover, delay: 1500 }, url });
        await page.waitForSelector('.dp-loading');
        // Measured from the page title, so the page's own entrance settling (a fraction of a pixel) is not counted.
        const top = selector => page.evaluate(sel => Math.round(document.querySelector(sel).getBoundingClientRect().top - document.querySelector('h1.c-title').getBoundingClientRect().top), selector);
        const loading = await top('.dp-loading'); // where the wait is drawn
        await page.waitForSelector('.dp-loading', { state: 'detached', timeout: 8000 });
        const loaded = await top('.ex-panel > :first-child'); // where the first thing that arrived is drawn
        expect(loading === loaded, `${size} ${name}: the first content moved from ${loading} to ${loaded}`);
        await context.close();
      }
    }
  });

  await check('the clear button in the search field hands focus to the field', async () => {
    const { context, page } = await open(browser, { discover: data, url: '/explore?q=cell' });
    await page.waitForSelector('.exg-card');
    await page.getByRole('button', { name: 'Clear search' }).click();
    expect(await page.evaluate(() => document.activeElement?.id) === 'ex-q', 'focus should be on the search field, is ' + await page.evaluate(() => document.activeElement?.tagName));
    expect((await page.inputValue('#ex-q')) === '', 'field emptied');
    await context.close();
  });

  await check('a set title underlines on hover, with no colour or weight change', async () => {
    const { context, page } = await open(browser, { discover: data });
    await page.waitForSelector('.exg-title');
    const title = page.locator('.exg-title').first();
    const read = () => title.evaluate(node => { const s = getComputedStyle(node); return { line: s.textDecorationLine, tint: s.color + s.fontWeight }; });
    const before = await read();
    await title.hover();
    const after = await read();
    expect(before.line === 'none' && after.line === 'underline', `underline on hover: ${before.line} -> ${after.line}`);
    expect(before.tint === after.tint, 'colour and weight unchanged');
    await context.close();
  });

  await check('suggestions are fetched once while the page is open', async () => {
    const { context, page } = await open(browser, { discover: data, url: '/explore?q=zebra' });
    const suggestionRequests = [];
    page.on('request', request => { if (/\/discover\/guides\?/.test(request.url()) && /[?&]limit=/.test(request.url())) suggestionRequests.push(request.url()); });
    await page.waitForSelector('h2:has-text("Popular public sets")');
    await page.fill('#ex-q', 'giraffe');
    await page.waitForSelector('.dp-empty:has-text("giraffe")');
    await page.fill('#ex-q', 'walrus');
    await page.waitForSelector('.dp-empty:has-text("walrus")');
    await page.waitForTimeout(500);
    expect(await page.locator('h2:has-text("Popular public sets")').count() === 1, 'suggestions still shown');
    expect(suggestionRequests.length === 0, 'no new suggestion requests after the first search: ' + suggestionRequests.length);
    await context.close();
    const fresh = await open(browser, { discover: data, url: '/explore' });
    const total = [];
    fresh.page.on('request', request => { if (/\/discover\/guides\?/.test(request.url()) && /[?&]limit=/.test(request.url())) total.push(request.url()); });
    await fresh.page.fill('#ex-q', 'giraffe');
    await fresh.page.waitForSelector('h2:has-text("From your classmates")');
    await fresh.page.fill('#ex-q', 'walrus');
    await fresh.page.waitForSelector('.dp-empty:has-text("walrus")');
    await fresh.page.fill('#ex-q', 'okapi');
    await fresh.page.waitForSelector('.dp-empty:has-text("okapi")');
    await fresh.page.waitForTimeout(500);
    expect(total.length <= 2, 'at most 2 suggestion requests across three empty searches, got ' + total.length);
    await fresh.context.close();
  });

  await check('the panel shows the shared focus ring when keyboard actions give it focus', async () => {
    const { context, page } = await open(browser, { discover: data, url: '/explore?q=zebra' });
    await page.waitForSelector('.dp-empty .c-btn');
    await page.locator('.dp-empty .c-btn').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tabpanel', null, { timeout: 2000 });
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth, focusVisible: document.activeElement.matches(':focus-visible') }; });
    expect(ring.focusVisible && ring.style === 'solid' && ring.width === '2px', 'ring: ' + JSON.stringify(ring));
    await context.close();
  });

  await check('a verified instructor is marked once on a set', async () => {
    const { context, page } = await open(browser, { discover: data });
    await page.waitForSelector('.exg-card');
    const card = page.locator('.exg-card', { hasText: 'Due process' });
    const said = await card.evaluate(node => (node.textContent.match(/Verified instructor/g) || []).length);
    expect(said === 1, 'said once, said ' + said);
    expect(await card.locator('svg.lucide-badge-check').count() === 1, 'one check icon');
    await context.close();
  });

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main();
