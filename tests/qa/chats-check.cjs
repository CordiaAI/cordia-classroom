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
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n').slice(0, 3).join(' | ').slice(0, 400)}`); }
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

    await check(`${label}: the chat's ⋯ menu ${api === 'full' ? 'works' : 'is not offered (the row menus neither) until chats can be changed'}`, async () => {
      const { page, state, context } = await session(browser, api);
      await ready(page, `/chat/${SAVED}`, '.chat-home-title');
      if (api !== 'full') {
        expect(await page.$$eval('.chat-home-menu, .c-side-chat-more', e => e.length) === 0, 'no ⋯ in the header or on the rows');
        await context.close();
        return;
      }
      await page.click('.chat-home-menu button');
      const items = await page.$$eval('[role=menuitem]', elements => elements.map(element => [element.textContent.trim(), element.getAttribute('aria-disabled') === 'true']));
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
    expect(!(await rows(page)).some(row => row.includes('Portfolio')), 'and leaves the list: ' + JSON.stringify(await rows(page)) + ' ' + await page.$$eval('.c-side-chat-row', e => e.map(x => x.className)));
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
    expect((await page.evaluate(() => document.body.innerText.match(/still answering/gi) || [])).length === 1, 'the busy message is said once');
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


  // ---- Fix round on #273 ------------------------------------------------------------------------

  const TITLES = /Career portfolio|Thesis for the EH|chain rule/;
  const watchSidebar = page => page.evaluate(() => {
    window.__leaks = [];
    const read = () => { const area = document.querySelector('.c-side-chats'); const text = area ? area.textContent : ''; if (/Career portfolio|Thesis for the EH|chain rule/.test(text)) window.__leaks.push(text.slice(0, 80)); };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
    setInterval(read, 16);
  });

  await check('two accounts in one tab: B signs in over A with the network failing, and none of A\'s titles ever render', async () => {
    const { page, state, context, problems } = await session(browser, 'full');
    await ready(page, '/home');
    expect((await rows(page)).some(row => row.includes('Career')), 'A sees its own chats');
    await watchSidebar(page);
    // B signs in; its first answer never comes.
    state.chatsDown = true;
    await page.evaluate(() => { localStorage.setItem('userId', 'user-b'); window.postMessage({ type: 'CORDIA_AUTH_UPDATED' }, window.location.origin); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(1500);
    expect(!TITLES.test(await text(page, '.c-side-chats')), 'B: no titles');
    expect((await text(page, '.c-side-chats')).includes('Try again'), 'B sees a retry, not A\'s list');
    same(await page.evaluate(() => window.__leaks), [], 'A\'s titles never rendered after the switch');
    // And when B's list does load it is B's.
    state.chatsDown = false;
    state.chats = [{ id: 'd0000000-0000-4000-8000-0000000000b1', guide_id: null, class_id: null, title: 'B only chat', renamed: false, messages: [{ role: 'user', text: 'B only chat' }], created_at: ago(9), updated_at: ago(9) }];
    state.tutor.messages = [];
    await page.click('.c-side-retry');
    await page.waitForTimeout(800);
    same(await rows(page), ['B only chat'], 'B\'s own list');
    same(problems, [], 'page errors');
    await context.close();
  });

  await check('signing out empties Recent chats at once', async () => {
    const { page, context } = await session(browser, 'full');
    await ready(page, '/home');
    expect((await rows(page)).length > 0, 'chats shown');
    await watchSidebar(page);
    await page.evaluate(() => { ['authToken', 'userId', 'refreshToken'].forEach(key => localStorage.removeItem(key)); window.postMessage({ type: 'CORDIA_AUTH_UPDATED' }, window.location.origin); });
    await page.waitForTimeout(400);
    same(await page.evaluate(() => window.__leaks), [], 'no title rendered after sign-out');
    await context.close();
  });

  const FAILS = [
    ['network', 'network', /Couldn't reach Classroom/],
    ['409 busy', [409, 'Wait for Cordia Tutor to finish before starting a new chat'], /still answering/],
    ['409 changed', [409, 'Tutor conversation changed. Refresh and try again.'], /moved on in another tab/],
    ['404 class gone', [404, 'Class not found'], /deleted in another tab/],
  ];
  for (const api of ['full', undefined]) {
    for (const [name, fail, wanted] of FAILS) {
      await check(`${api ? 'C' : 'A'}: a failed first send (${name}) leaves the home as it is, with the notice above the composer, the text kept and one current item`, async () => {
        const { page, state, context } = await session(browser, api);
        await ready(page, '/home');
        state.startFail = fail;
        await page.fill('textarea', 'What is a derivative?');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1600);
        expect(path_(page) === '/home', `address ${path_(page)}`);
        expect(await page.$('.chat-home.is-chat') === null, 'still the home layout');
        expect(await page.$('.chat-home-headline') !== null, 'the headline is back');
        expect(await page.$('.cordia-tutor-message') === null, "no earlier conversation shows");
        const body = await page.evaluate(() => document.body.innerText);
        expect(wanted.test(body), `says why: ${body.slice(0, 0)}`);
        expect(await page.inputValue('textarea') === 'What is a derivative?', 'typed text kept');
        same(await current(page), ['New chat'], 'one current sidebar item');
        if (fail !== 'network') {
          const notice = await page.locator('.chat-notice').boundingBox();
          const composer = await page.locator('.chat-home-composer').boundingBox();
          expect(notice && notice.y + notice.height <= composer.y + 1, 'the notice sits above the composer');
        }
        await context.close();
      });
    }
  }

  await check('402 from the home: the composer never snaps (it moves one way down and one way back) and nothing shifts', async () => {
    const { page, state, context } = await session(browser, 'full');
    await ready(page, '/home');
    state.tutorLimit = true;
    state.chatDelay = 500;
    await page.fill('textarea', 'What is a limit?');
    const before = await page.locator('.chat-home-composer').boundingBox();
    await page.evaluate(() => {
      window.__tops = []; window.__cls = 0;
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value; }).observe({ type: 'layout-shift', buffered: false });
      const sample = () => { const element = document.querySelector('.chat-home-composer'); if (element) window.__tops.push(element.getBoundingClientRect().top); window.__raf = requestAnimationFrame(sample); };
      sample();
    });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2600);
    const { tops, cls } = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return { tops: window.__tops, cls: window.__cls }; });
    const peak = tops.indexOf(Math.max(...tops));
    const up = tops.slice(0, peak + 1).every((top, i, all) => i === 0 || top >= all[i - 1] - 1);
    const down = tops.slice(peak).every((top, i, all) => i === 0 || top <= all[i - 1] + 1);
    expect(up, 'going down it never steps back: ' + tops.slice(0, peak + 1).map(Math.round).join(','));
    expect(down, 'coming back it never steps down again: ' + tops.slice(peak).map(Math.round).join(','));
    expect(cls < 0.02, `layout shift ${cls.toFixed(3)}`);
    expect(await page.$('[role=dialog]') !== null, 'upgrade dialog');
    expect(await page.inputValue('textarea') === 'What is a limit?', 'typed text kept');
    const after = await page.locator('.chat-home-composer').boundingBox();
    expect(Math.abs(after.y - before.y) <= 40, `the composer is back where the home has it: ${before.y} -> ${after.y}`);
    await context.close();
  });

  await check('C: Undo by keyboard (Ctrl+Z), the toast waits for the pointer and for focus, and a screen reader hears it', async () => {
    const { page, state, context } = await session(browser, 'full');
    await ready(page, '/home');
    const del = async () => {
      await page.hover('.c-side-chat-row:nth-child(2)');
      await page.focus('.c-side-chat-row:nth-child(2) .c-side-chat-more');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[role=menuitem]:has-text("Delete")');
      await page.focus('[role=menuitem]:has-text("Delete")');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.c-chat-toast');
    };
    await del();
    const heard = await text(page, '.sr-only[role=status]');
    expect(/Chat deleted/.test(heard) && /Press (Control|Command) Z to undo/.test(heard), `announced: ${heard}`);
    expect(await page.getAttribute('.c-chat-toast button', 'aria-keyshortcuts') === 'Control+Z Meta+Z', 'the shortcut is declared');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);
    expect((await rows(page)).some(row => row.startsWith('Career')), 'Ctrl+Z undid it');
    expect(!state.chats.find(chat => chat.id === SAVED).deleted_at, 'restored on the server');
    // The pointer holds it.
    await del();
    await page.hover('.c-chat-toast');
    await page.waitForTimeout(7200);
    expect(await page.$('.c-chat-toast') !== null, 'still there after 7s under the pointer');
    await page.mouse.move(700, 450);
    await page.waitForTimeout(1200);
    expect(await page.$('.c-chat-toast') !== null, 'and it gets the rest of its time after the pointer leaves');
    await page.waitForSelector('.c-chat-toast', { state: 'detached', timeout: 8000 });
    await page.keyboard.press('Control+z');
    // Focus holds it too.
    state.chats.find(chat => chat.id === SAVED).deleted_at = null;
    await page.reload(); await page.waitForSelector('.chat-home'); await page.waitForTimeout(900);
    await del();
    await page.focus('.c-chat-toast button');
    await page.waitForTimeout(7200);
    expect(await page.$('.c-chat-toast') !== null, 'still there after 7s with focus on Undo');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    expect((await rows(page)).some(row => row.startsWith('Career')), 'Enter on Undo undid it');
    // Ctrl+Z in a box that holds text is the box's own Undo.
    await del();
    await page.fill('textarea', 'half a thought');
    await page.focus('textarea');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    expect(!(await rows(page)).some(row => row.startsWith('Career')), 'typing keeps its own Undo');
    await context.close();
  });

  await check('C: a student with 45 chats reaches all 45 (Show more), and the list scrolls', async () => {
    const { page, state, context } = await session(browser, 'full');
    for (let index = 0; index < 42; index += 1) state.chats.push({ id: `d0000000-0000-4000-8000-${String(1000 + index).padStart(12, '0')}`, guide_id: null, class_id: null, title: `Study chat ${index}`, renamed: false, messages: [{ role: 'user', text: `Study chat ${index}` }], created_at: ago(1000 + index), updated_at: ago(1000 + index) });
    await ready(page, '/home');
    expect((await rows(page)).length === 30, `30 first: ${(await rows(page)).length}`);
    await page.click('.c-side-more-btn');
    await page.waitForTimeout(1000);
    expect((await rows(page)).length === 45, `45 after: ${(await rows(page)).length}`);
    expect(await page.$('.c-side-more-btn') === null, 'the button goes');
    expect(await page.evaluate(() => document.activeElement.closest('[data-chat-row]') !== null), 'focus lands on a chat, not the page');
    await context.close();
  });

  await check('the chat ⋯ menu: Escape steps out of Move to class first, then closes; and every other menu in the app keeps Escape, Tab and focus return', async () => {
    const { page, context } = await session(browser, 'full');
    await ready(page, `/chat/${SAVED}`, '.chat-home-title');
    await page.click('.chat-home-menu button');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await page.$('.c-menu-back') !== null, 'second level open');
    await page.keyboard.press('Escape');
    expect(await page.$('[role=menu]') !== null && await page.$('.c-menu-back') === null, 'one Escape: back to the first level, still open');
    expect(await page.evaluate(() => document.activeElement.textContent.includes('Move to class')), 'on the row that opened it');
    await page.keyboard.press('Escape');
    expect(await page.$('[role=menu]') === null, 'second Escape closes');
    expect(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Chat options', 'focus back on the ⋯');
    // The same Menu elsewhere.
    for (const url of ['/library', `/folder/${CALC}`, '/guide/a0000000-0000-4000-8000-000000000001', '/home']) {
      await page.goto(BASE + url);
      await page.waitForTimeout(1800);
      const triggers = await page.$$('[aria-haspopup=menu]');
      let tried = 0;
      for (const trigger of triggers) {
        if (!(await trigger.isVisible())) continue;
        const label = await trigger.getAttribute('aria-label');
        if (/Recent chats/.test(label || '')) continue;
        await trigger.click();
        if (!(await page.$('[role=menu]'))) continue;
        await page.keyboard.press('Escape');
        expect(await page.$('[role=menu]') === null, `${url} ${label}: Escape closes`);
        expect(await trigger.evaluate(element => element === document.activeElement), `${url} ${label}: focus back on the button`);
        await trigger.click();
        await page.keyboard.press('Tab');
        expect(await page.$('[role=menu]') === null, `${url} ${label}: Tab closes`);
        expect(await page.evaluate(() => document.activeElement !== document.body), `${url} ${label}: focus is not lost`);
        tried += 1;
        if (tried >= 2) break;
      }
      expect(tried > 0, `${url}: has a menu to try`);
    }
    await context.close();
  });

  // V1-V3 (review threads on #273). A saved chat about the second guide, open, then a question.
  const GUIDE_B = 'a0000000-0000-4000-8000-000000000002';
  async function askInSavedChat({ liveFull = false, move = false }) {
    const { page, state, context } = await session(browser, 'full');
    state.chats[0].guide_id = GUIDE_B;
    state.chats[0].class_id = null;
    if (liveFull) state.tutor.messages = Array.from({ length: 30 }, (_, i) => [{ role: 'user', text: `Question ${i + 1}` }, { role: 'ai', text: 'An answer.' }]).flat();
    const sent = [];
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/chat') sent.push(JSON.parse(request.postData() || '{}')); });
    await ready(page, `/chat/${SAVED}`, '.chat-home-title');
    if (move) {
      await page.hover(`[data-chat-row="${SAVED}"]`);
      await page.click(`[data-chat-row="${SAVED}"] .c-side-chat-more`);
      await page.click('[role=menuitem]:has-text("Move to class")');
      await page.click('[role=menuitem]:has-text("Business")');
      await page.waitForTimeout(700);
    }
    await page.fill('textarea', 'Explain it again');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1800);
    await context.close();
    return sent;
  }
  await check('V1: an opened chat sends its own guide with each question, not another guide\'s', async () => {
    const sent = await askInSavedChat({});
    expect(sent.length === 1, `the question went out (${sent.length})`);
    expect(sent[0].guide_id === GUIDE_B, `guide ${sent[0]?.guide_id}`);
  });
  await check('V2: a full live conversation does not block continuing a different saved chat', async () => {
    const sent = await askInSavedChat({ liveFull: true });
    expect(sent.length === 1, `the question went out (${sent.length})`);
  });
  await check('V3: moving the open chat from its Recent chats row changes the class its next question goes with', async () => {
    const sent = await askInSavedChat({ move: true });
    expect(sent.length === 1 && sent[0].class_id === BUS, `class ${sent[0]?.class_id}`);
  });

  await check('L5 the composer takes focus after Delete in a chat; L12 the toast and the row leave with a fade (none with reduced motion)', async () => {
    for (const reduced of [false, true]) {
      const { page, context } = await session(browser, 'full');
      if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
      await ready(page, `/chat/${SAVED}`, '.chat-home-title');
      await page.click('.chat-home-menu button');
      await page.click('[role=menuitem]:has-text("Delete")');
      const seen = [];
      for (let i = 0; i < 24; i += 1) { seen.push(await page.evaluate(() => document.activeElement?.tagName)); await page.waitForTimeout(50); }
      expect(seen[seen.length - 1] === 'TEXTAREA', `focus ends on the composer: ${seen.join(',')}`);
      expect(!seen.slice(8).includes('BODY'), `focus is never on the page after 400ms: ${seen.join(',')}`);
      const leavingRow = await page.$('.c-side-chat-row.is-leaving');
      expect(reduced ? leavingRow === null : true, 'reduced motion: no fade');
      await page.waitForSelector('.c-chat-toast');
      await page.click('.c-chat-toast button');
      await page.waitForTimeout(60);
      const leaving = await page.$('.c-chat-toast[data-leaving]');
      expect(reduced ? await page.$('.c-chat-toast') === null : leaving !== null, reduced ? 'reduced motion: toast goes at once' : 'toast fades before it leaves');
      await page.waitForTimeout(400);
      expect(await page.$('.c-chat-toast') === null, 'then it is gone');
      await context.close();
    }
  });

  await check('L12 a deleted row folds shut instead of vanishing', async () => {
    const { page, context } = await session(browser, 'full');
    await ready(page, '/home');
    await page.hover('.c-side-chat-row:nth-child(2)');
    await page.click('.c-side-chat-row:nth-child(2) .c-side-chat-more');
    await page.click('[role=menuitem]:has-text("Delete")');
    await page.waitForTimeout(70);
    expect(await page.$('.c-side-chat-row.is-leaving') !== null, 'the row is still there, leaving');
    await page.waitForTimeout(400);
    expect(await page.$('.c-side-chat-row.is-leaving') === null, 'and then gone');
    await context.close();
  });

  await check('L7 notice buttons 8px apart; L8 a title only gives up room for the ⋯ while it shows; L9 no chat ⋯ on a phone; L10 Reload the chat answers', async () => {
    const { page, state, context } = await session(browser, 'full');
    await ready(page, `/chat/${SAVED}`, '.chat-home-title');
    const pad = () => page.$eval(`[data-chat-row="${SAVED}"] .c-side-chat`, element => getComputedStyle(element).paddingRight);
    await page.mouse.move(700, 450);
    await page.waitForTimeout(300);
    expect(await pad() === '12px', `resting padding ${await pad()}`);
    await page.hover(`[data-chat-row="${SAVED}"]`);
    await page.waitForTimeout(300);
    expect(await pad() === '40px', `hover padding ${await pad()}`);
    otherTab.remove(state, SAVED);
    await page.reload();
    await page.waitForSelector('.chat-home-missing');
    await page.waitForTimeout(800);
    expect(await page.$eval('.chat-notice-actions, .chat-home-missing .chat-notice-actions', element => getComputedStyle(element).columnGap) === '8px', 'gap 8px');
    await page.click('.chat-home-missing button:has-text("Reload the chat")');
    await page.waitForTimeout(900);
    expect((await text(page, '.chat-home-missing')).includes("still gone"), 'says it is still gone: ' + await text(page, '.chat-home-missing'));
    await context.close();
    const phone = await session(browser, 'full', { width: 390, height: 844 });
    await ready(phone.page, '/home');
    await phone.page.fill('textarea', 'What is the product rule?');
    await phone.page.keyboard.press('Enter');
    await phone.page.waitForTimeout(1800);
    expect(await phone.page.$('.chat-home-title') !== null, 'the chat header is there');
    expect(await phone.page.$eval('.chat-home-menu', element => getComputedStyle(element).display) === 'none', 'no ⋯ on a phone');
    await phone.context.close();
  });

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
