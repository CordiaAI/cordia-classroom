// Behavior checks for the glass-fixes bug list, run in a real browser against a local build
// with the mocked API (never production):  BASE=http://localhost:3100 node tests/qa/behavior-check.cjs
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const G = 'a0000000-0000-4000-8000-000000000001';
const results = [];

function problems(count, extra = {}) {
  return Array.from({ length: count }, (_, i) => ({ type: 'written', prompt: `Problem ${i + 1}`, answer: `Answer ${i + 1}`, ...extra }));
}

async function session(browser, { theme = 'light', populated = true, meta = null, width = 1440, setup } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const state = createState(populated);
  if (meta) state.meta = meta;
  await install(context, state);
  if (setup) await setup(context, state);
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, theme]) => {
    localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', theme);
  }, [TOKEN, USER, theme]);
  return { context, page, state };
}

async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push([false, name]);
    console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n')[0].slice(0, 200)}`);
  }
}

function expect(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new'] });

  await check('Notes: a new empty note is never saved', async () => {
    const { context, page, state } = await session(browser);
    await page.goto(BASE + '/smartnotes?id=new');
    await page.waitForTimeout(4500);
    expect(!state.calls.includes('POST /smart_notes'), `created on open: ${state.calls.filter(c => c.includes('smart_notes')).join(', ')}`);
    await page.locator('.sn-paper, [contenteditable="true"]').first().click();
    await page.keyboard.type('Mitochondria make energy');
    await page.waitForTimeout(2500);
    expect(state.calls.includes('POST /smart_notes'), 'not created after typing');
    expect(/id=n\d+/.test(page.url()), `url not updated: ${page.url()}`);
    await context.close();
  });

  await check('Notes: "All notes" dropdown closes on Escape and outside click', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/smartnotes?id=n1');
    await page.waitForTimeout(1200);
    await page.locator('.sn-notes-dropdown-trigger').click();
    expect(await page.locator('.sn-notes-dropdown').isVisible(), 'did not open');
    await page.keyboard.press('Escape');
    expect(!(await page.locator('.sn-notes-dropdown').count()), 'Escape did not close it');
    await page.locator('.sn-notes-dropdown-trigger').click();
    await page.mouse.click(20, 600);
    expect(!(await page.locator('.sn-notes-dropdown').count()), 'outside click did not close it');
    await context.close();
  });

  await check('Notes: 12px between "Material" and "Open"', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/smartnotes?id=n1');
    await page.waitForTimeout(1200);
    const gap = await page.evaluate(() => {
      const label = [...document.querySelectorAll('.sn-viewer-toolbar .sn-panel-label')][0].getBoundingClientRect();
      const open = document.querySelector('.sn-viewer-toolbar .sn-viewer-controls').getBoundingClientRect();
      return open.left - label.right;
    });
    expect(gap >= 12, `gap ${gap}px`);
    await context.close();
  });

  await check('Today: Start goes straight into practice when no cards are due', async () => {
    const { context, page } = await session(browser, {
      setup: async (context, state) => {
        state.guides.forEach(guide => { guide.flashcards = []; });
        await context.route(/localhost:8000\/practice\/[^/]+\/state/, route => route.fulfill({ json: { practice: { problems: problems(10), progress: {} } } }));
      },
    });
    await page.goto(BASE + '/session');
    await page.waitForURL(/\/practice\//, { timeout: 8000 });
    await context.close();
  });

  await check('Practice: each visit starts fresh (no old answer or "Not quite")', async () => {
    const { context, page } = await session(browser, {
      setup: context => context.route(/localhost:8000\/practice\/[^/]+\/state/, route => route.fulfill({ json: { practice: {
        problems: problems(10),
        progress: { problemIndex: 0, answers: { 0: 'my old wrong answer', 1: 'right' }, evaluations: { 0: { status: 'incorrect', message: 'Not quite' }, 1: { status: 'correct' } } },
      } } })),
    });
    await page.goto(BASE + `/practice/${G}`);
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body.innerText);
    expect(!text.includes('Not quite'), '"Not quite" shown on load');
    const values = await page.evaluate(() => [...document.querySelectorAll('textarea, input')].map(el => el.value));
    expect(!values.includes('my old wrong answer'), 'old answer restored');
    await context.close();
  });

  await check('Flashcards: Ask sends the question to the Tutor right away', async () => {
    const { context, page, state } = await session(browser);
    await page.goto(BASE + '/session');
    await page.waitForTimeout(1500);
    await page.locator('.fc-ask').click();
    await page.waitForTimeout(3000);
    expect(state.calls.includes('POST /chat'), `no chat request: ${state.calls.filter(c => /chat|tutor/.test(c)).join(', ')}`);
    await context.close();
  });

  await check('Tutor: no hidden controls over "Ask anything"', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/tutor');
    await page.waitForTimeout(1500);
    expect(!(await page.locator('.cordia-tutor-attach, .cordia-tutor-explain-toggle').count()), 'hidden buttons still rendered');
    await page.locator('.tutor-context-controls > summary').first().click();
    await page.locator('.cordia-tutor-attach').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    expect(await page.locator('.cordia-tutor-attach').isVisible(), 'Attach missing when Options is open');
    await context.close();
  });

  await check('Theme: the account choice wins and does not flip after opening the Tutor', async () => {
    const { context, page } = await session(browser, { theme: 'dark', meta: { cordia: { v: 1, at: Date.now(), theme: 'light', used: [], done: [], tips: [], grove: {}, rings: {}, freeze: [] } } });
    await page.goto(BASE + '/dashboard');
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light', 'account theme (light) did not win over the cache');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:tutor-toggle')));
    await page.waitForTimeout(800);
    await page.goto(BASE + '/tutor');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light', 'flipped after opening Tutor');
    await context.close();
  });

  await check('Theme: set before first paint (no wrong-color flash)', async () => {
    const { context, page } = await session(browser, { theme: 'dark' });
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        if (document.body) { window.__firstPaintTheme = document.documentElement.getAttribute('data-theme'); observer.disconnect(); }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(BASE + '/dashboard');
    expect(await page.evaluate(() => window.__firstPaintTheme) === 'dark', `theme at first paint: ${await page.evaluate(() => window.__firstPaintTheme)}`);
    await context.close();
  });

  await check('/billing opens the Plan tab', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/billing');
    await page.waitForURL(/section=plan/, { timeout: 8000 });
    await page.waitForTimeout(800);
    expect(await page.locator('#tab-plan[aria-selected="true"]').count(), 'Plan tab not selected');
    await context.close();
  });

  await check('Pricing: signed in shows the app nav and "Current plan"', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/pricing');
    await page.waitForTimeout(1500);
    expect(await page.locator('.c-topbar').count(), 'no app nav');
    expect(await page.getByText('Current plan').count(), 'no "Current plan"');
    expect(!(await page.getByText('Start free').count()), 'public "Start free" still shown');
    await context.close();
  });

  await check('Help: full-screen scrim like the New sheet', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/dashboard');
    await page.waitForTimeout(1200);
    await page.locator('.c-topbar .c-avatar').click();
    await page.getByRole('menuitem', { name: 'Help' }).click();
    await page.waitForTimeout(400);
    const box = await page.locator('.c-scrim').boundingBox();
    expect(box && box.width >= 1440 && box.height >= 900, `scrim ${JSON.stringify(box)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect(!(await page.locator('.c-scrim').count()), 'Escape did not close Help');
    await context.close();
  });

  await check('Calendar: the pasted link is checked before Connect', async () => {
    const { context, page } = await session(browser, { populated: false });
    await page.goto(BASE + '/calendar');
    await page.waitForTimeout(1500);
    expect(await page.locator('.canvas-shot').count() === 3, 'missing the three Canvas pictures');
    const input = page.locator('[data-spot="calendar-feed"]');
    await input.fill('https://school.instructure.com/courses/1');
    expect(await page.getByRole('button', { name: 'Connect' }).isDisabled(), 'Connect enabled for a non-.ics link');
    expect(await page.locator('#cal-link-problem').isVisible(), 'no message for a bad link');
    await input.fill('https://school.instructure.com/feeds/calendars/user_abc.ics');
    expect(await page.getByRole('button', { name: 'Connect' }).isEnabled(), 'Connect disabled for a valid link');
    await context.close();
  });

  await check('Learn Cordia: Calendar is not ticked without a connected calendar', async () => {
    const { context, page } = await session(browser, { populated: false, meta: { cordia: { v: 1, at: Date.now(), used: ['calendar'], done: ['day1'], tips: [], grove: {}, rings: {}, freeze: [] } } });
    await page.goto(BASE + '/dashboard');
    await page.waitForTimeout(2500);
    const ticked = await page.evaluate(() => [...document.querySelectorAll('.learn li.is-used')].map(li => li.textContent).join('|'));
    expect(!/Calendar/.test(ticked), `still ticked: ${ticked}`);
    await context.close();
  });

  await check('Heatmap: past 12 months, ending today', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/settings');
    await page.waitForTimeout(1500);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.heat-cell')].map(cell => cell.getAttribute('aria-label')));
    const today = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    expect(labels.length >= 365 && labels.length <= 372, `${labels.length} days`);
    expect(labels[labels.length - 1].startsWith(today), `last day ${labels[labels.length - 1]}`);
    await context.close();
  });

  await browser.close();
  const failed = results.filter(([ok]) => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} behavior checks pass.`);
  process.exit(failed ? 1 : 0);
})();
