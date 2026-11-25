// Moving and deleting guides in a real browser against a local dev server and the mock API (feedback F3).
// Every move from the class page crashed (its handler was named moveGuide and called itself), so the
// first check clicks it through. Run the app on the port first:
//   npm run dev --prefix web -- -p 3125
//   BASE=http://localhost:3125 CHROME=/path/to/chrome node tests/qa/guide-move-check.cjs   (ONLY=regex runs some checks)
// The first visit to a page in `next dev` compiles it, so the waits below are generous.
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3125';
const FILM = 'f0000000-0000-4000-8000-000000000002';
const MGT = 'f0000000-0000-4000-8000-000000000001';
const SUPPLY = 'a0000000-0000-4000-8000-000000000001';
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n').slice(0, 3).join(' | ').slice(0, 500)}`); }
}

function seed(setup) {
  const state = createState(true);
  state.folders = [{ id: MGT, name: 'MGT 300 Operations' }, { id: FILM, name: 'FILM 201 Cinema' }];
  state.guides[0].title = 'Supply chains';
  state.guides[0].folder_id = MGT;
  state.guides[1].folder_id = null;
  state.guides[2].folder_id = null;
  setup?.(state);
  return state;
}

async function session(browser, { width = 1440, height = 900, setup } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const state = seed(setup);
  await install(context, state);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', 'light'); }, [TOKEN, USER]);
  return { context, page, state, problems };
}

const toastText = page => page.evaluate(() => [...document.querySelectorAll('.c-toast')].map(element => element.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
const moves = state => state.calls.filter(call => /^PATCH \/guides\/[^/]+\/move$/.test(call));

// Open a row's ⋯ menu, then Move to class, then pick the class by its name.
async function moveFromMenu(page, title, className) {
  await page.getByRole('button', { name: `More for ${title}` }).first().click();
  await page.getByRole('menuitem', { name: /Move to class/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(className) }).click();
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--headless=new'] });

  await check('class page: moving a guide sends the PATCH, says Moved to, and the row is in its new class', async () => {
    const { context, page, state, problems } = await session(browser);
    await page.goto(BASE + `/folder/${MGT}`);
    await page.waitForSelector('text=Supply chains', { timeout: 60000 });
    await moveFromMenu(page, 'Supply chains', 'FILM 201 Cinema');
    await page.waitForFunction(() => document.querySelector('.c-toast'), null, { timeout: 5000 });
    expect(moves(state).length === 1, `moves sent: ${JSON.stringify(moves(state))}`);
    expect(/Moved to FILM 201 Cinema/.test(await toastText(page)), `toast: ${await toastText(page)}`);
    expect(state.guides[0].folder_id === FILM, `guide is in ${state.guides[0].folder_id}`);
    expect((await page.locator('.folder-row-title', { hasText: 'Supply chains' }).count()) === 0, 'the row is still on the old class page');
    await page.goto(BASE + `/folder/${FILM}`);
    await page.locator('.folder-row-title', { hasText: 'Supply chains' }).waitFor({ timeout: 30000 });
    expect(!problems.length, `page errors: ${problems.join(' | ')}`);
    await context.close();
  });

  await check('class page: a move that fails says what did not happen and why', async () => {
    const { context, page, state } = await session(browser, { setup: state => { state.failRoute = (method, p) => (/\/move$/.test(p) ? { status: 503, json: { detail: 'upstream connect error' } } : undefined); } });
    await page.goto(BASE + `/folder/${MGT}`);
    await page.locator('.folder-row-title', { hasText: 'Supply chains' }).waitFor({ timeout: 60000 });
    await moveFromMenu(page, 'Supply chains', 'FILM 201 Cinema');
    await page.waitForFunction(() => document.querySelector('.c-toast'), null, { timeout: 5000 });
    const text = await toastText(page);
    expect(text === "That guide wasn't moved: Classroom ran into a problem. Try again.", `toast: ${text}`);
    expect(!/upstream/.test(text), 'the 5xx detail leaked into the copy');
    expect(state.guides[0].folder_id === MGT, 'the guide moved anyway');
    expect((await page.locator('.folder-row-title', { hasText: 'Supply chains' }).count()) === 1, 'the row left the page though nothing moved');
    await context.close();
  });

  await check('class page: a shared guide that is moved says it is no longer shared', async () => {
    const { context, page, state } = await session(browser, { setup: state => { state.sharedWith = { [SUPPLY]: 'MGT 300' }; } });
    await page.goto(BASE + `/folder/${MGT}`);
    await page.waitForSelector('text=Supply chains', { timeout: 60000 });
    await moveFromMenu(page, 'Supply chains', 'FILM 201 Cinema');
    await page.waitForFunction(() => document.querySelector('.c-toast'), null, { timeout: 5000 });
    const text = await toastText(page);
    expect(text === 'Moved to FILM 201 Cinema. No longer shared with MGT 300.', `toast: ${text}`);
    await context.close();
  });

  await check('Library: one move sends only the PATCH (no list is read again)', async () => {
    const { context, page, state, problems } = await session(browser);
    await page.goto(BASE + '/library');
    await page.waitForSelector('text=Supply chains', { timeout: 60000 });
    await page.waitForTimeout(1500);
    const before = state.calls.length;
    await moveFromMenu(page, 'Supply chains', 'FILM 201');
    await page.waitForFunction(() => document.querySelector('.c-toast'), null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    const sent = state.calls.slice(before);
    expect(sent.length === 1 && /^PATCH \/guides\/[^/]+\/move$/.test(sent[0]), `requests after the move: ${JSON.stringify(sent)}`);
    expect(/Moved to FILM 201/.test(await toastText(page)), `toast: ${await toastText(page)}`);
    expect(!problems.length, `page errors: ${problems.join(' | ')}`);
    await context.close();
  });

  await check('Library: a delete right after a move shows Undo at once, and Undo puts the row back', async () => {
    const { context, page, state } = await session(browser);
    await page.goto(BASE + '/library');
    await page.waitForSelector('text=Supply chains', { timeout: 60000 });
    await moveFromMenu(page, 'Supply chains', 'FILM 201');
    await page.waitForFunction(() => /Moved to/.test(document.body.innerText), null, { timeout: 5000 });
    await page.getByRole('button', { name: 'More for Cell Biology Basics' }).first().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // Undo must be there within a moment, not after the "Moved to" message runs out (2.5 seconds).
    await page.getByRole('button', { name: 'Undo' }).waitFor({ timeout: 700 });
    expect(!/Moved to/.test(await toastText(page)), `toast: ${await toastText(page)}`);
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForSelector('text=Cell Biology Basics');
    expect(!state.calls.some(call => call.startsWith('DELETE /guides/')), 'Undo still sent the delete');
    await context.close();
  });

  await check('Library: a failed delete shows its reason over Undo, and the row comes back', async () => {
    const { context, page, state } = await session(browser, { setup: state => { state.failRoute = (method, p) => (method === 'DELETE' && p.startsWith('/guides/') ? { status: 500, json: { detail: 'boom' } } : undefined); } });
    await page.goto(BASE + '/library');
    await page.waitForSelector('text=Cell Biology Basics', { timeout: 60000 });
    await page.getByRole('button', { name: 'More for Cell Biology Basics' }).first().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Undo' }).waitFor({ timeout: 2000 });
    await page.getByText("That guide wasn't deleted: Classroom ran into a problem. Try again.").waitFor({ timeout: 9000 });
    await page.waitForSelector('text=Cell Biology Basics');
    expect(state.guides.some(guide => guide.title === 'Cell Biology Basics'), 'the guide is gone from the server');
    await context.close();
  });

  await check('class page: deleting a class whose shared class could not be left goes to Library and says so', async () => {
    const { context, page, state } = await session(browser, { setup: state => {
      state.folders[0].class_id = 'c0000000-0000-4000-8000-000000000001';
      state.failRoute = (method, p) => (method === 'DELETE' && p.startsWith('/classes/') ? { status: 503, json: { detail: 'unavailable' } } : undefined);
    } });
    await page.goto(BASE + `/folder/${MGT}`);
    await page.waitForSelector('text=Supply chains', { timeout: 60000 });
    await page.getByRole('button', { name: 'Class actions' }).click();
    await page.getByRole('menuitem', { name: /Delete class/ }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForURL(/\/library/, { timeout: 8000 });
    await page.getByText(/was deleted, but you are still in its shared class: Classroom ran into a problem\./).waitFor({ timeout: 5000 });
    expect(!state.folders.some(folder => folder.id === MGT), 'the class folder is still on the server');
    await context.close();
  });

  await browser.close();
  const failed = results.filter(result => !result).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.error(error); process.exit(1); });
