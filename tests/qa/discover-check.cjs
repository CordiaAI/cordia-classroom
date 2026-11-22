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
        expect(await page.locator('.exg-filters').count() === 1, 'the filter row is there in every state, so it never comes and goes');
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

  // The filter row is there whenever the Sets tab is, so nothing below the search moves between loading
  // and loaded. Every state is opened, then every way of getting out of it is taken with the answer held
  // for a moment; the row's top and the first content under it are read in the wait and again when it ends.
  const EMPTY = { guides: [], classmates: [], classrooms: [], people: [] };
  const TRANSITIONS = [
    ['with sets', 'first load', data, '/explore', null],
    ['with sets', 'search finds nothing', data, '/explore', page => page.fill('#ex-q', 'zebra')],
    ['with sets', 'filter finds nothing', data, '/explore', page => page.locator('select[aria-label="School"]').selectOption('s1')],
    ['with sets', 'tick From my classrooms', data, '/explore', page => page.getByLabel('From my classrooms').click()],
    ['empty search', 'clear search (x)', data, '/explore?q=zebra', page => page.getByRole('button', { name: 'Clear search' }).first().click()],
    ['empty search', 'clear search (button)', data, '/explore?q=zebra', page => page.locator('.dp-empty .c-btn').click()],
    ['filtered', 'filter to Any', data, '/explore?school=s1', page => page.locator('select[aria-label="School"]').selectOption('')],
    ['filtered', 'clear filters (button)', data, '/explore?school=s1', page => page.locator('.dp-empty .c-btn').click()],
    ['from my classrooms', 'untick', data, '/explore?from_my_classrooms=true', page => page.getByLabel('From my classrooms').click()],
    ['failed', 'Try again', { ...data, fail: 'guides' }, '/explore', (page, state) => { state.discover.fail = false; return page.getByRole('button', { name: 'Try again' }).click(); }],
    ['empty catalogue', 'first load', EMPTY, '/explore', null],
    ['empty catalogue', 'search then nothing', EMPTY, '/explore', page => page.fill('#ex-q', 'zebra')],
    ['empty catalogue', 'clear search (x)', EMPTY, '/explore?q=zebra', page => page.getByRole('button', { name: 'Clear search' }).first().click()],
    ['empty catalogue', 'clear search (button)', EMPTY, '/explore?q=zebra', page => page.locator('.dp-empty .c-btn').click()],
    ['empty catalogue', 'filter to Any', EMPTY, '/explore?school=s1', page => page.locator('select[aria-label="School"]').selectOption('')],
    ['empty catalogue', 'clear filters (button)', EMPTY, '/explore?school=s1', page => page.locator('.dp-empty .c-btn').click()],
    ['empty catalogue', 'untick From my classrooms', EMPTY, '/explore?from_my_classrooms=true', page => page.getByLabel('From my classrooms').click()],
    ['empty catalogue', 'Try again', { ...EMPTY, fail: 'guides' }, '/explore', (page, state) => { state.discover.fail = false; return page.getByRole('button', { name: 'Try again' }).click(); }],
  ];
  const table = [];
  for (const size of ['desktop', 'phone']) {
    for (const [name, move, discover, url, act] of TRANSITIONS) {
      await check(`nothing below the search moves: ${size}, ${name}, ${move}`, async () => {
        const { context, page, state } = await open(browser, { size, discover: { ...discover, delay: act ? 0 : 1500 }, url });
        // Measured from the page title, so the page's own entrance settling (a fraction of a pixel) is not counted.
        const read = () => page.evaluate(() => {
          const title = document.querySelector('h1.c-title').getBoundingClientRect().top;
          const row = document.querySelector('.exg-filters');
          const after = row?.nextElementSibling;
          return { row: row ? Math.round(row.getBoundingClientRect().top - title) : null, content: after ? Math.round(after.getBoundingClientRect().top - title) : null, kind: after?.className || '' };
        });
        if (act) {
          await page.waitForSelector(discover.fail ? '.dp-empty [role="alert"]' : '.exg-filters', { timeout: 20000 });
          await page.waitForTimeout(400); // the first load settles, then the transition starts from rest
          state.discover.delay = 1500;
          await act(page, state);
        }
        await page.waitForSelector('.dp-loading', { timeout: 4000 });
        const loading = await read();
        await page.waitForSelector('.dp-loading', { state: 'detached', timeout: 10000 });
        await page.waitForTimeout(150);
        const loaded = await read();
        table.push(`${size.padEnd(7)} ${name.padEnd(19)} ${move.padEnd(26)} row ${loading.row}/${loaded.row}  content ${loading.content}/${loaded.content}`);
        expect(loading.row !== null && loaded.row !== null, `the filter row must be there while loading (${loading.row}) and when loaded (${loaded.row})`);
        expect(loading.row === loaded.row, `the filter row moved from ${loading.row} to ${loaded.row}`);
        expect(loading.content === loaded.content, `the first content moved from ${loading.content} to ${loaded.content}`);
        await context.close();
      });
    }
  }
  console.log('\n     size    state               transition                 y of filter row and of first content, loading/loaded (px below the title)\n' + table.map(row => '     ' + row).join('\n') + '\n');

  await check('a filter change on an empty catalogue keeps focus on the control that changed', async () => {
    const { context, page, state } = await open(browser, { discover: { ...EMPTY }, url: '/explore?school=s1&from_my_classrooms=true' });
    await page.waitForSelector('.dp-empty');
    state.discover.delay = 600;
    const school = page.locator('select[aria-label="School"]');
    await school.focus(); // as a person would have, picking from it
    await school.selectOption('');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'School', 'focus should stay on School right after the change');
    await page.waitForSelector('.dp-loading');
    await page.waitForSelector('.dp-loading', { state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'School', 'and after the answer: ' + await page.evaluate(() => document.activeElement?.tagName));
    const box = page.getByLabel('From my classrooms');
    await box.focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('.dp-loading');
    await page.waitForSelector('.dp-loading', { state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.closest('.exg-check') !== null), 'focus should stay on the From my classrooms box');
    expect(await page.locator('.exg-filters').count() === 1, 'the row is still there with nothing narrowing');
    await context.close();
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

  await check('if one suggestion request fails the other group stays and the missing one is asked for next time', async () => {
    const { context, page } = await open(browser, { discover: data, url: '/explore' });
    let classmatesFail = true;
    const asked = [];
    await page.route(/\/discover\/guides\?.*limit=/, async route => {
      const url = route.request().url();
      const which = /from_my_classrooms/.test(url) ? 'classmates' : 'popular';
      asked.push(which);
      if (which === 'classmates' && classmatesFail) return route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } });
      return route.fallback();
    });
    await page.fill('#ex-q', 'giraffe');
    await page.waitForSelector('.dp-empty:has-text("giraffe")');
    while (asked.length < 2) await page.waitForTimeout(50); // both suggestion requests have been answered
    await page.waitForTimeout(300);
    expect(await page.locator('h2:has-text("Popular public sets")').count() === 1, 'the good group shows');
    expect(await page.locator('h2:has-text("From your classmates")').count() === 0, 'classmates failed, so not shown yet');
    classmatesFail = false;
    await page.fill('#ex-q', 'walrus');
    await page.waitForSelector('.dp-empty:has-text("walrus")');
    await page.waitForSelector('h2:has-text("From your classmates")');
    expect(await page.locator('h2:has-text("Popular public sets")').count() === 1, 'the good group is kept');
    expect(asked.join() === 'popular,classmates,classmates', 'popular once, classmates twice: ' + asked.join());
    await context.close();
  });

  await check('the panel ring follows the card radius', async () => {
    const { context, page } = await open(browser, { discover: data, url: '/explore?q=zebra' });
    await page.waitForSelector('.dp-empty .c-btn');
    await page.locator('.dp-empty .c-btn').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tabpanel', null, { timeout: 2000 });
    const radius = await page.evaluate(() => ({ panel: getComputedStyle(document.activeElement).borderTopLeftRadius, card: getComputedStyle(document.documentElement).getPropertyValue('--r-card').trim() }));
    expect(radius.panel === radius.card && parseFloat(radius.panel) > 0, 'panel radius ' + JSON.stringify(radius));
    await context.close();
  });

  await check('no fixed choice (Updated, Made by, Length) is cut off in the filter row, at 390 and at desktop', async () => {
    for (const size of ['phone', 'desktop']) {
      const { context, page } = await open(browser, { size, discover: data, url: '/explore' });
      await page.waitForSelector('.exg-card');
      const cut = await page.evaluate(() => {
        const out = [];
        const canvas = document.createElement('canvas').getContext('2d');
        // School, Course and Term list the catalogue's own names, which can be any length and are cut with an ellipsis by design.
        document.querySelectorAll('.exg-filters select').forEach(select => {
          if (['School', 'Course', 'Term'].includes(select.getAttribute('aria-label'))) return;
          const style = getComputedStyle(select);
          canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          [...select.options].forEach(option => { const need = canvas.measureText(option.textContent).width; if (need > room) out.push(`${select.getAttribute('aria-label')}: "${option.textContent}" needs ${Math.ceil(need)} of ${Math.floor(room)}`); });
        });
        return out;
      });
      expect(cut.length === 0, `${size}: ` + cut.join(' | '));
      await context.close();
    }
  });

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main();
