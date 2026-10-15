// Browser test: connect Canvas by token (mocked), accept a class suggestion, share a set,
// see it as a second student in the same class, and hide it with three reports.
//
// Needs: the web app on BASE (default http://localhost:3100, built with the default API URL
// http://localhost:8000) and `python tests/e2e/canvas_test_server.py` on :8100.
// Run: node tests/e2e/canvas-classes.e2e.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const API = 'http://127.0.0.1:8100';
const CANVAS_TOKEN = '1234~' + 'Zq9'.repeat(21) + 'w';
const GUIDE_ID = 'c0000000-0000-4000-8000-000000000001';
const SCREENS = process.env.SCREENS || '';

function b64(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function tokenFor(sub, name) { return `${b64({ alg: 'HS256' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, user_metadata: { name } })}.sig`; }
const USERS = {
  owner: { id: '11111111-2222-4333-8444-555555555555', name: 'Olive Owner' },
  b: { id: '22222222-2222-4333-8444-555555555555', name: 'Bea B' },
  c: { id: '33333333-2222-4333-8444-555555555555', name: 'Cal C' },
  d: { id: '44444444-2222-4333-8444-555555555555', name: 'Dee D' },
};

const GUIDE_TEXT = 'Q1: What is span of control?\nA1: The number of direct reports a manager supervises in an organizational design.\n'
  + 'Q2: What is unity of command?\nA2: Each employee reports to one manager, which supports clear planning and leadership.\n'
  + 'Q3: What drives motivation?\nA3: Leadership, goals and feedback shape motivation in management practice.';

async function api(pathname, options = {}) {
  const response = await fetch(API + pathname, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  return response.json();
}

async function signedIn(browser, user, { viewport = { width: 1280, height: 860 }, colorScheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport, colorScheme });
  const state = createState(false);
  state.onboarding = { step: 'done', completed: true };
  state.meta = { cordia: { v: 1, at: Date.now(), wt: null, day1Status: 'done', done: ['day1'], used: [], tips: [], grove: {}, rings: {}, freeze: [], first: Date.now() } };
  if (user === USERS.owner) {
    state.guides = [{ id: GUIDE_ID, title: 'Span of Control Review', folder_id: null, created_at: new Date().toISOString(), read_progress: 0, is_bookmarked: false,
      study_guide: GUIDE_TEXT, notes: '', flashcards: [{ front: 'Span of control', back: 'Direct reports' }, { front: 'Unity of command', back: 'One manager' }], flashcard_progress: {} }];
  }
  await install(context, state);
  // The new routes go to the real routers on the local test server.
  await context.route(/localhost:8000\/(canvas|classes|sharing|admin)(\/|\?|$)/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const response = await route.fetch({ url: API + url.pathname + url.search });
    await route.fulfill({ response });
  });
  // Saved copies live on the test server.
  await context.route(/localhost:8000\/guides\/[0-9a-f-]{36}$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const response = await fetch(`${API}/__test/guide/${id}`);
    if (!response.ok) return route.fallback();
    return route.fulfill({ json: await response.json() });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(BASE + '/pricing');
  await page.evaluate(([token, id]) => {
    localStorage.setItem('authToken', token); localStorage.setItem('userId', id); localStorage.setItem('refreshToken', 'r');
    localStorage.setItem('cordiaSchool', 'Testu');
  }, [tokenFor(user.id, user.name), user.id]);
  return { context, page, errors, state };
}

async function shot(page, name) {
  if (SCREENS) await page.screenshot({ path: path.join(SCREENS, name + '.png') });
}

async function joinByAddClass(page) {
  await page.goto(BASE + '/library?tab=classes');
  await page.getByRole('button', { name: 'Add class' }).click();
  const school = page.getByLabel('School');
  await school.fill('');
  await school.fill('Test');
  await page.getByRole('option', { name: 'Testu' }).click({ timeout: 8000 }).catch(async error => {
    if (SCREENS) await page.screenshot({ path: path.join(SCREENS, 'debug-add-class.png') });
    throw error;
  });
  await page.getByLabel('Course code').fill('MGT');
  await page.getByRole('option', { name: /MGT 300/ }).click();
  await page.getByRole('link', { name: /MGT 300/ }).waitFor();
}

(async () => {
  const results = [];
  const step = async (name, fn) => {
    try { await fn(); results.push(`ok   ${name}`); } catch (error) { results.push(`FAIL ${name}: ${error.message.split('\n')[0]}`); throw error; }
  };
  await api('/__test/seed', { method: 'POST', body: JSON.stringify({
    canvas_school_policy: [{ domain: 'canvas.missouri.edu', school_name: 'University of Missouri', tokens_allowed: false }],
    study_guides: [{ id: GUIDE_ID, user_id: USERS.owner.id, title: 'Span of Control Review', study_guide: GUIDE_TEXT, notes: 'private owner notes', folder_id: null,
      flashcards: [{ front: 'Span of control', back: 'Direct reports' }, { front: 'Unity of command', back: 'One manager' }] }],
  }) });

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new'] });
  let failed = false;
  try {
    const owner = await signedIn(browser, USERS.owner);
    const { page } = owner;

    await step('school that disallows tokens shows only the Calendar feed', async () => {
      await page.goto(BASE + '/settings?section=canvas');
      await page.getByRole('button', { name: 'Access token' }).click();
      await page.getByLabel('Canvas URL').fill('canvas.missouri.edu');
      await page.getByText("Your school doesn't allow tokens").waitFor();
      await page.getByRole('button', { name: 'Close' }).click();
    });

    await step('connect Canvas with a token and import a class', async () => {
      await page.getByRole('button', { name: 'Access token' }).click();
      await page.getByRole('heading', { name: 'Connect Canvas' }).waitFor();
      for (const label of ['Open Canvas', 'New token', 'Paste here']) await page.getByRole('heading', { name: label }).waitFor();
      await page.getByText('Your token can do anything you can do in Canvas. Cordia only reads.').waitFor();
      await page.getByLabel('Canvas URL').fill('https://testu.instructure.com');
      await page.getByLabel('Token').fill(CANVAS_TOKEN);
      const connect = page.getByRole('button', { name: 'Connect', exact: true });
      assert.equal(await connect.isDisabled(), true, 'Connect waits for "I understand"');
      await page.getByLabel('I understand').check();
      await shot(page, 'canvas-connect');
      await connect.click();
      await page.getByRole('heading', { name: 'Your classes' }).waitFor();
      const dialog = page.getByRole('dialog', { name: 'Your classes' });
      await dialog.getByRole('switch', { name: 'Import MGT-300-102' }).check({ force: true });
      await page.waitForFunction(() => document.querySelector('[role="dialog"] input[role="switch"]:checked'));
      await page.waitForTimeout(300);
      await shot(page, 'canvas-classes');
      await page.getByRole('button', { name: 'Done' }).click();
      await page.getByText('•••• ' + CANVAS_TOKEN.slice(-4)).waitFor();
      const html = await page.content();
      assert.ok(!html.includes(CANVAS_TOKEN), 'token never reaches the page after saving');
      const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
      assert.ok(!storage.includes(CANVAS_TOKEN), 'token not kept in browser storage');
      const tables = await api('/__test/tables');
      assert.equal(tables.canvas_tokens_count, 1);
      assert.ok(!JSON.stringify(tables).includes(CANVAS_TOKEN), 'token stored only as ciphertext');
      await page.getByRole('button', { name: 'Activity' }).click();
      await page.getByText('Classes', { exact: true }).first().waitFor();
      await shot(page, 'canvas-settings');
    });

    await step('accept the AI class suggestion and share the set', async () => {
      await page.goto(BASE + '/guide/' + GUIDE_ID);
      const chip = page.getByRole('button', { name: 'Add to MGT 300?' });
      await chip.waitFor();
      await shot(page, 'class-chip');
      await chip.click();
      await page.getByRole('heading', { name: 'Share with MGT 300?' }).waitFor();
      await shot(page, 'share-sheet');
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await page.getByText('Shared with MGT 300').waitFor();
      const tables = await api('/__test/tables');
      const shared = tables.shared_sets[0];
      assert.equal(shared.visibility, 'class');
      assert.equal(shared.status, 'visible');
      assert.ok(!JSON.stringify(shared).includes('private owner notes'), 'notes are never shared');
    });

    const b = await signedIn(browser, USERS.b);
    await step('a second student in the same class sees and saves the set', async () => {
      await joinByAddClass(b.page);
      await b.page.getByRole('link', { name: /MGT 300/ }).click();
      await b.page.getByRole('heading', { name: /MGT 300/ }).waitFor();
      await b.page.getByText('Span of Control Review').waitFor();
      await b.page.getByText('2 cards').waitFor();
      await shot(b.page, 'class-page');
      await b.page.getByRole('button', { name: 'Save' }).click();
      await b.page.waitForURL(/\/guide\//);
      await b.page.getByRole('heading', { level: 1, name: /Span of Control Review/ }).waitFor();
    });

    await step('three reports hide the set', async () => {
      const reporters = [b, await signedIn(browser, USERS.c), await signedIn(browser, USERS.d)];
      for (const [index, reporter] of reporters.entries()) {
        if (index > 0) await joinByAddClass(reporter.page);
        await reporter.page.goto(BASE + '/library?tab=classes');
        await reporter.page.getByRole('link', { name: /MGT 300/ }).click();
        await reporter.page.getByRole('button', { name: 'More for Span of Control Review' }).click();
        await reporter.page.getByRole('menuitem', { name: 'Report' }).click();
        await reporter.page.getByRole('menuitem', { name: 'Wrong' }).click();
        await reporter.page.getByText('Reported').waitFor();
      }
      await b.page.reload();
      await b.page.getByText('No shared sets').waitFor();
      const tables = await api('/__test/tables');
      assert.equal(tables.shared_sets[0].status, 'hidden');
      await shot(b.page, 'class-page-hidden');
    });

    await step('narrow screens: no horizontal scroll on Canvas and class pages', async () => {
      for (const width of [360, 390]) {
        const narrow = await signedIn(browser, USERS.owner, { viewport: { width, height: 800 }, colorScheme: 'dark' });
        for (const route of ['/settings?section=canvas', '/library?tab=classes']) {
          await narrow.page.goto(BASE + route);
          await narrow.page.waitForTimeout(800);
          const overflow = await narrow.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert.ok(overflow <= 1, `${route} overflows by ${overflow}px at ${width}`);
        }
        await shot(narrow.page, `classes-${width}-dark`);
        await narrow.context.close();
      }
    });

    for (const session of [owner, b]) assert.deepEqual(session.errors, [], 'no page errors');
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    await browser.close();
  }
  console.log(results.join('\n'));
  console.log(failed ? 'E2E FAILED' : 'E2E PASSED');
  process.exit(failed ? 1 : 0);
})();
