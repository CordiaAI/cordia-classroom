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

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main();
