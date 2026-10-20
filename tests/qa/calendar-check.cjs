// Calendar with a slow feed (5 s, like a real Canvas feed) against a local build, mocked API:
// a connected account never sees the "connect your feed" steps, returning is instant, and a
// disconnected account still gets the steps.   BASE=http://localhost:3100 node tests/qa/calendar-check.cjs
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n')[0].slice(0, 240)}`); }
}

async function session(browser, { connected = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const state = createState(true);
  await install(context, state);
  await context.route(/localhost:8000\/calendar\/connection$/, async route => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    route.fulfill({ json: connected ? { connected: true, items: [{ id: 'c1', title: 'Lab report [BIO-101]', due_at: new Date(Date.now() + 86400000).toISOString(), type: 'assignment' }] } : { connected: false } });
  });
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); }, [TOKEN, USER]);
  return { context, page };
}

// Samples the page every 100 ms for `ms` and reports whether the connect steps ever appeared.
async function watch(page, ms) {
  let sawSteps = false;
  let firstItemAt = null;
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await page.locator('text=Open Canvas Calendar').count()) sawSteps = true;
    if (firstItemAt === null && await page.locator('.calendar-item:has-text("Lab report")').count()) firstItemAt = Date.now() - start;
    await page.waitForTimeout(100);
  }
  return { sawSteps, firstItemAt };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new'] });

  await check('Connected, first visit, 5 s feed: loader, never the connect steps', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/calendar');
    await page.locator('.c-loader').waitFor({ timeout: 3000 });
    const seen = await watch(page, 6500);
    expect(!seen.sawSteps, 'connect steps flashed for a connected account');
    expect(seen.firstItemAt !== null, 'items never appeared');
    await context.close();
  });

  await check('Connected, returning: events show at once while the feed refreshes', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/calendar');
    await page.locator('.calendar-item').first().waitFor({ timeout: 10000 });
    await page.goto(BASE + '/dashboard');
    await page.goto(BASE + '/calendar');
    const seen = await watch(page, 1500);
    expect(!seen.sawSteps, 'connect steps flashed');
    expect(seen.firstItemAt !== null && seen.firstItemAt < 1000, `events took ${seen.firstItemAt} ms`);
    await context.close();
  });

  await check('After Today loads the feed, Calendar opens instantly', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/dashboard');
    await page.waitForTimeout(6500);
    await page.goto(BASE + '/calendar');
    const seen = await watch(page, 1200);
    expect(!seen.sawSteps && seen.firstItemAt !== null && seen.firstItemAt < 1000, `events took ${seen.firstItemAt} ms`);
    await context.close();
  });

  await check('Not connected: the connect steps still show (after the check)', async () => {
    const { context, page } = await session(browser, { connected: false });
    await page.goto(BASE + '/calendar');
    await page.locator('text=Open Canvas Calendar').waitFor({ timeout: 10000 });
    await context.close();
  });

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
