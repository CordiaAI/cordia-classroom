// Saved chats in a real browser against a local dev server and the mock API, in each backend state
// (docs/redesign/PLAN.md T5): A today's backend (/chats answers 404), B the new backend before its
// migration (editable false), C the new backend with it. Run the app on the port first:
//   npm run dev --prefix web -- -p 3108
//   BASE=http://localhost:3108 CHROME=/path/to/chrome node tests/qa/chats-check.cjs   (ONLY=regex runs some checks)
// The first visit to a page in `next dev` compiles it, so the waits below are generous.
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER, otherTab } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3108';
const CALC = 'f0000000-0000-4000-8000-000000000001';
const BUS = 'f0000000-0000-4000-8000-000000000002';
const LIVE = 'd0000000-0000-4000-8000-000000000090';
const SAVED = 'd0000000-0000-4000-8000-000000000001';
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const same = (actual, wanted, message) => expect(JSON.stringify(actual) === JSON.stringify(wanted), `${message}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`);

async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n')[0].slice(0, 300)}`); }
}

function seed(api) {
  const state = createState(true);
  state.folders = [{ id: CALC, name: 'Calculus I', code: 'MA 125' }, { id: BUS, name: 'Business Ethics', code: 'BUS 101' }];
  state.guides[0].folder_id = CALC;
  state.chatsApi = api;
  state.chats = [
    { id: SAVED, guide_id: null, class_id: BUS, title: 'Career portfolio outline', renamed: false, messages: [{ role: 'user', text: 'Career portfolio outline' }, { role: 'ai', text: 'Start with three projects that show range.' }], created_at: ago(300), updated_at: ago(300) },
    { id: 'd0000000-0000-4000-8000-000000000002', guide_id: null, class_id: null, title: 'Thesis for the EH 101 essay', renamed: false, messages: [{ role: 'user', text: 'Thesis for the EH 101 essay' }], created_at: ago(900), updated_at: ago(900) },
  ];
  state.tutor.messages = [{ role: 'user', text: 'Why does the chain rule work?' }, { role: 'ai', text: 'Because the inner function changes the rate.' }];
  state.tutor.updated_at = ago(5);
  state.tutor.active_guide_id = state.guides[0].id;
  state.tutor.conversation_version = 4;
  if (api === 'full') { state.liveId = LIVE; state.live = { class_id: CALC, created_at: ago(5) }; }
  return state;
}

async function session(browser, api, { width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const state = seed(api);
  await install(context, state);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', 'light'); }, [TOKEN, USER]);
  return { context, page, state, problems };
}

const text = (page, selector) => page.evaluate(sel => { const element = document.querySelector(sel); return element ? element.textContent.replace(/\s+/g, ' ').trim() : ''; }, selector);
const current = page => page.$$eval('[aria-current="page"]', elements => elements.map(element => element.textContent.trim()));
const rows = page => page.$$eval('.c-side-chat-row', items => items.map(item => item.textContent.trim()));
const path_ = page => new URL(page.url()).pathname;
async function ready(page, url, selector = '.chat-home') { await page.goto(BASE + url); await page.waitForSelector(selector); await page.waitForTimeout(900); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new'] });
  const states = [['A', undefined], ['B', 'fallback'], ['C', 'full']];
  const liveId = api => (api === 'full' ? LIVE : 's1');

  for (const [label, api] of states) {
    await check(`${label}: the first message makes a chat at its own address, current in Recent chats, and reload restores it`, async () => {
      const { page, problems, context } = await session(browser, api);
      await ready(page, '/home');
      same(await current(page), ['New chat'], 'home');
      await page.fill('textarea', 'What is the product rule?');
      await page.keyboard.press('Enter');
      await page.waitForURL(/\/chat\//, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      expect(path_(page).startsWith('/chat/'), `address ${path_(page)}`);
      same(await current(page), ['What is the product rule?'], 'one current item, the chat');
      await page.reload();
      await page.waitForSelector('.chat-home-title');
      await page.waitForTimeout(900);
      expect(await text(page, '.chat-home-title') === 'What is the product rule?', 'title');
      expect((await rows(page)).length === 4, 'history is all there');
      same(problems, [], 'page errors');
      await context.close();
    });

    await check(`${label}: the chat's ⋯ menu ${api === 'full' ? 'works' : 'is disabled with a reason'}`, async () => {
      const { page, state, context } = await session(browser, api);
      await ready(page, `/chat/${SAVED}`, '.chat-home-title');
      await page.click('.chat-home-menu button');
      const items = await page.$$eval('[role=menuitem]', elements => elements.map(element => [element.textContent.trim(), element.getAttribute('aria-disabled') === 'true']));
      if (api === 'full') {
        same(items.map(item => item[1]), [false, false, false], 'all enabled');
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Chat options', 'Escape returns to the ⋯ button');
        await page.click('.chat-home-menu button');
        await page.click('[role=menuitem]:has-text("Delete")');
        await page.waitForURL(/\/home/, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(400);
        expect(path_(page) === '/home', 'delete goes home');
        expect((await text(page, '.c-chat-toast')).includes('Undo'), 'toast with Undo');
        await page.click('.c-chat-toast button');
        await page.waitForTimeout(600);
        expect((await rows(page)).some(row => row.startsWith('Career')), 'Undo puts it back');
        expect(!state.chats.find(chat => chat.id === SAVED).deleted_at, 'restored on the server');
      } else {
        same(items.map(item => item[1]), [true, true, true], 'all disabled');
        expect((await text(page, '.c-menu-note')).length > 10, 'a reason is shown');
        expect(await page.$$eval('.c-side-chat-more', e => e.length) === 0, 'no row menus');
      }
      await context.close();
    });

    await check(`${label}: a chat deleted in another tab says so, with a way forward`, async () => {
      const { page, state, context } = await session(browser, api);
      state.chats = state.chats.filter(chat => chat.id !== SAVED);
      await ready(page, `/chat/${SAVED}`);
      const message = await text(page, '.chat-home-missing');
      expect(message.includes('This chat was deleted or moved in another tab.') && message.includes('Go to the home'), message);
      await context.close();
    });

    await check(`${label}: sending after the conversation moved on keeps the typed text and says so`, async () => {
      const { page, state, context } = await session(browser, api);
      await ready(page, `/chat/${liveId(api)}`, '.chat-home-title');
      otherTab.newChat(state);
      await page.fill('textarea', 'And what about sin of x squared?');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
      // B has no id of its own for the live chat, so a new chat elsewhere can read as "gone" there.
      const said = await text(page, '.chat-notice');
      expect(said.includes('This conversation moved on in another tab.') || (api === 'fallback' && said.includes('deleted or moved in another tab')), said);
      expect(await page.inputValue('textarea') === 'And what about sin of x squared?', 'typed text kept');
      await context.close();
    });

    await check(`${label}: the first message hitting a plan limit opens the upgrade dialog, keeps the text and returns to the home`, async () => {
      const { page, state, context } = await session(browser, api);
      await ready(page, '/home');
      state.tutorLimit = true;
      state.chatDelay = 500;
      await page.fill('textarea', 'What is a limit?');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2200);
      expect(await page.$('[role=dialog]') !== null, 'upgrade dialog');
      expect(path_(page) === '/home', `address ${path_(page)}`);
      expect(await page.inputValue('textarea') === 'What is a limit?', 'typed text kept');
      same(await current(page), ['New chat'], 'back on the home');
      await context.close();
    });
  }

  await check('C: rename, move to a class, and a chat gone elsewhere', async () => {
    const { page, state, context } = await session(browser, 'full');
    await ready(page, `/chat/${SAVED}`, '.chat-home-title');
    await page.click('.chat-home-menu button');
    await page.keyboard.press('Enter');
    await page.fill('.chat-home-rename', 'Portfolio plan');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect(await text(page, '.chat-home-title') === 'Portfolio plan', 'renamed');
    await page.click('.chat-home-menu button');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.click('[role=menuitem]:has-text("Calculus")');
    await page.waitForTimeout(500);
    expect(state.chats.find(chat => chat.id === SAVED).class_id === CALC, 'moved on the server');
    otherTab.remove(state, SAVED);
    await page.click('.chat-home-menu button');
    await page.click('[role=menuitem]:has-text("Delete")');
    await page.waitForTimeout(800);
    expect((await text(page, '.chat-notice')).includes('deleted or moved in another tab'), 'gone chat says so');
    expect(!(await rows(page)).some(row => row.includes('Portfolio')), 'and leaves the list');
    await context.close();
  });

  await check('C: Undo on a chat purged in the meantime says it can not come back', async () => {
    const { page, state, context } = await session(browser, 'full');
    await ready(page, '/home');
    await page.hover('.c-side-chat-row:nth-child(2)');
    await page.click('.c-side-chat-row:nth-child(2) .c-side-chat-more');
    await page.click('[role=menuitem]:has-text("Delete")');
    await page.waitForTimeout(500);
    otherTab.purge(state, SAVED);
    await page.click('.c-chat-toast button');
    await page.waitForTimeout(800);
    expect((await text(page, '.c-chat-toast')).includes("can't come back"), await text(page, '.c-chat-toast'));
    await context.close();
  });

  await check('the home answers "the Tutor is still answering" in plain words and keeps the text', async () => {
    const { page, state, context } = await session(browser, 'full');
    await ready(page, '/home');
    state.tutor.status = 'running';
    await page.fill('textarea', 'Explain limits');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1400);
    expect((await text(page, '.chat-notice')).includes('still answering'), await text(page, '.chat-notice'));
    expect(await page.inputValue('textarea') === 'Explain limits', 'typed text kept');
    await context.close();
  });

  await check('no connection: the chat page and Recent chats offer a plain retry', async () => {
    const { page, state, context } = await session(browser, 'full');
    state.chatsDown = true;
    await ready(page, `/chat/${SAVED}`);
    expect((await text(page, '.chat-home-missing')).includes('Try again'), 'page retry');
    expect((await text(page, '.c-side-chats')).includes('Try again'), 'sidebar retry');
    state.chatsDown = false;
    await page.click('.chat-home-missing button:has-text("Try again")');
    await page.waitForSelector('.chat-home-title');
    await context.close();
  });

  await check('phones send a chat to the Tutor page with it open, and the Dashboard when it is gone', async () => {
    for (const [api, id, wanted] of [[undefined, SAVED, '/tutor'], ['full', SAVED, '/tutor'], ['full', 'missing-chat', '/dashboard']]) {
      const { page, context } = await session(browser, api, { width: 390, height: 844 });
      await page.goto(`${BASE}/chat/${id}`);
      await page.waitForURL(url => !url.pathname.startsWith('/chat/'), { timeout: 40000 }).catch(() => {});
      await page.waitForTimeout(500);
      expect(path_(page) === wanted, `${api} ${id}: ${path_(page)}`);
      await context.close();
    }
  });

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
