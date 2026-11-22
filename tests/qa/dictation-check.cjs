// Dictation in a real browser with a fake speech recognizer (web/lib/dictation.mjs, useDictation.js),
// in Chromium (Chrome-style events on window.SpeechRecognition) and WebKit (Safari-style events on
// window.webkitSpeechRecognition: cumulative interims from index 0, finals sent twice). The fake
// cannot say how real Safari behaves; it replays the two sequences. Run the app first:
//   npm run dev --prefix web -- -p 3116
//   BASE=http://localhost:3116 node tests/qa/dictation-check.cjs
const path = require('path');
const { chromium, webkit } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3116';
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const same = (actual, wanted, message) => expect(actual === wanted, `${message}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`);

async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n').slice(0, 3).join(' | ').slice(0, 400)}`); }
}

// A recognizer the test drives: emit(resultIndex, [[transcript, isFinal], ...]) sends a result event;
// silence() ends it as a recognizer does after a pause. stop() and abort() end it as the real ones do.
const FAKE = prefixed => `
  (() => {
    class Fake {
      constructor() { window.__rec = this; window.__calls = []; }
      start() { window.__calls.push('start'); this.live = true; }
      stop() { window.__calls.push('stop'); this.finish(); }
      abort() { window.__calls.push('abort'); this.live = false; }
      finish() { if (!this.live) return; this.live = false; setTimeout(() => this.onend && this.onend(), 0); }
    }
    window.__error = code => { window.__rec.onerror && window.__rec.onerror({ error: code }); window.__rec.finish(); };
    window.__emit = (resultIndex, rows) => window.__rec.onresult({ resultIndex, results: rows.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
    window.__silence = () => window.__rec.finish();
    window.${prefixed ? 'webkitSpeechRecognition' : 'SpeechRecognition'} = Fake;
  })();`;

// Layout-shift entries exist in Chromium only; WebKit has no 'layout-shift' type. Geometry (the
// rects compared before and after) is what every check asserts in both browsers; the shift score is
// an extra check where the browser reports one, and the run says where it did not.
const startShiftScore = (page, scope = 'body') => page.evaluate(scope => {
  window.__cls = null;
  if (!(window.PerformanceObserver && PerformanceObserver.supportedEntryTypes || []).includes('layout-shift')) return;
  window.__cls = 0;
  new PerformanceObserver(list => { for (const entry of list.getEntries()) if (scope === 'body' || (entry.sources || []).some(source => source.node && source.node.nodeType === 1 && source.node.closest(scope))) window.__cls += entry.value; }).observe({ type: 'layout-shift' });
}, scope);
const noShift = async page => { const score = await page.evaluate(() => window.__cls); expect(score === null || score === 0, 'layout shift score ' + score); };

const box = page => page.locator('.composer-box');
const value = page => box(page).inputValue();
const interim = page => page.evaluate(() => document.querySelector('.dictation-interim')?.textContent || null);
const emit = (page, index, rows) => page.evaluate(([i, r]) => window.__emit(i, r), [index, rows]);
const mic = page => page.locator('button.composer-icon[aria-label*="isten"], button.composer-icon[aria-label*="Talk"]');

// url: a path, or a function of the mock state (a guide's page needs a guide's id); before(page): routes to add.
async function open(browser, prefixed, { width = 1440, height = 900, url = '/home', before } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(FAKE(prefixed));
  const state = createState(true);
  await install(context, state);
  const page = await context.newPage();
  if (before) await before(page);
  if (typeof url === 'function') url = url(state);
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', 'light'); }, [TOKEN, USER]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await page.goto(BASE + url); break; } catch (error) { if (attempt === 2) throw error; await page.waitForTimeout(500); }
  }
  if (url === '/home') {
    await page.waitForSelector('.composer-box', { timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.waitForSelector('button.composer-icon[aria-label="Talk to the Tutor"]', { timeout: 10000 });
  }
  return { context, page, problems, state };
}

const GROWING = ['What', 'What time', 'What time is', 'What time is it', 'What time is it right'];
const PHRASE = 'What time is it right now';

async function suite(label, browserType, prefixed) {
  const browser = await browserType.launch();
  const sequences = {
    chrome: async page => {
      for (const words of GROWING) { await emit(page, 0, [[words, false]]); await page.waitForTimeout(30); }
      await emit(page, 0, [[PHRASE, true]]);
    },
    safari: async page => {
      for (const words of GROWING) { await emit(page, 0, [[words, false]]); await page.waitForTimeout(30); }
      await emit(page, 0, [[PHRASE, true]]);
      await emit(page, 0, [[PHRASE, true]]);
    },
  };
  for (const [style, play] of Object.entries(sequences)) {
    await check(`${label}: ${style}-style events leave each word once, interim shown apart and replaced`, async () => {
      const { context, page } = await open(browser, prefixed);
      await mic(page).click();
      await emit(page, 0, [['What', false]]);
      await page.waitForTimeout(60);
      same(await interim(page), 'What', 'the first interim words show under the box');
      same(await value(page), '', 'the box holds nothing while words are interim');
      await emit(page, 0, [['What time', false]]);
      await page.waitForTimeout(60);
      same(await interim(page), 'What time', 'the interim line is replaced, not added to');
      const look = await page.evaluate(() => { const style = getComputedStyle(document.querySelector('.dictation-interim')); return { italic: style.fontStyle, size: style.fontSize }; });
      same(look.italic, 'italic', 'interim text is in italics');
      await play(page);
      await page.waitForTimeout(80);
      same(await value(page), PHRASE, 'the box has the phrase once');
      await context.close();
    });
  }

  await check(`${label}: typed text before and after the caret stays, the words go at the caret`, async () => {
    const { context, page } = await open(browser, prefixed);
    await box(page).fill('Explain after class');
    await box(page).evaluate(element => { element.focus(); element.setSelectionRange(8, 8); });
    await mic(page).click();
    await emit(page, 0, [['the chain rule', false]]);
    await emit(page, 0, [['the chain rule', true]]);
    await page.waitForTimeout(80);
    same(await value(page), 'Explain the chain rule after class', 'text before and after the caret is kept');
    await context.close();
  });

  await check(`${label}: Stop keeps the heard words and leaves no interim text`, async () => {
    const { context, page } = await open(browser, prefixed);
    await mic(page).click();
    await emit(page, 0, [['What time is it', true], ['right', false]]);
    await page.waitForTimeout(60);
    same(await interim(page), 'right', 'one word is still interim');
    await mic(page).click(); // Stop
    await page.waitForTimeout(150);
    same(await interim(page), null, 'the interim line is gone after Stop');
    same(await value(page), 'What time is it right', 'what was said stays in the box');
    expect((await page.evaluate(() => window.__calls)).includes('stop'), 'the recognizer was stopped');
    await context.close();
  });

  await check(`${label}: silence ends it cleanly`, async () => {
    const { context, page } = await open(browser, prefixed);
    await mic(page).click();
    await emit(page, 0, [['hello there', false]]);
    await emit(page, 0, [['hello there', true]]);
    await page.evaluate(() => window.__silence());
    await page.waitForTimeout(150);
    same(await interim(page), null, 'no interim line after silence');
    same(await value(page), 'hello there', 'the words stay');
    same(await mic(page).getAttribute('aria-pressed'), 'false', 'the mic is off');
    await context.close();
  });

  await check(`${label}: Send with words still interim stops the mic and leaves no interim text behind`, async () => {
    const { context, page } = await open(browser, prefixed);
    await mic(page).click();
    await emit(page, 0, [['Why does the chain rule work', true], ['and when', false]]);
    await page.waitForTimeout(60);
    same(await interim(page), 'and when', 'an interim phrase is showing');
    await box(page).press('Enter');
    await page.waitForTimeout(400);
    same(await interim(page), null, 'no interim text after Send');
    expect((await page.evaluate(() => window.__calls)).includes('abort'), 'the recognizer was aborted by Send');
    // Words that arrive after Send are ignored.
    await emit(page, 0, [['late words', true]]).catch(() => {});
    await page.waitForTimeout(100);
    expect(!(await value(page)).includes('late words'), 'late results do not refill the box');
    await context.close();
  });

  await check(`${label}: typing while listening takes the box back`, async () => {
    const { context, page } = await open(browser, prefixed);
    await mic(page).click();
    await emit(page, 0, [['hello', false]]);
    await box(page).click();
    await page.keyboard.type('x');
    await page.waitForTimeout(150);
    same(await interim(page), null, 'the interim line is gone once the student types');
    await emit(page, 0, [['hello world', true]]);
    await page.waitForTimeout(100);
    same(await value(page), 'x', 'results after that do not change what the student typed');
    await context.close();
  });

  await check(`${label}: keyboard and focus are unchanged`, async () => {
    const { context, page } = await open(browser, prefixed);
    await mic(page).focus();
    await page.keyboard.press('Enter'); // a button: Enter starts it
    await page.waitForTimeout(80);
    same(await mic(page).getAttribute('aria-pressed'), 'true', 'Enter on the mic turns it on');
    same(await page.evaluate(() => document.activeElement === document.querySelector('button.composer-icon.is-on')), true, 'focus stays on the mic');
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    same(await mic(page).getAttribute('aria-pressed'), 'false', 'Space on the mic turns it off');
    await context.close();
  });

  await check(`${label}: the composer does not move when the line fills, wraps or empties (0 px; shift score 0 where the browser reports one)`, async () => {
    const { context, page } = await open(browser, prefixed);
    await startShiftScore(page);
    const top = () => page.evaluate(() => { const form = document.querySelector('.composer').getBoundingClientRect(); const note = document.querySelector('.chat-home-note')?.getBoundingClientRect(); return [form.top, form.height, note ? note.top : 0].join(','); });
    const idle = await top();
    await mic(page).click();
    same(await top(), idle, 'turning the mic on moves nothing');
    await emit(page, 0, [['Why does the derivative of x squared equal two x', false]]);
    same(await top(), idle, 'first interim words move nothing');
    await emit(page, 0, [['Why does the derivative of x squared equal two x and how do I show it from the definition of a limit step by step please and then what', false]]);
    const one = await page.evaluate(() => document.querySelector('.dictation-interim').getBoundingClientRect().height);
    same(await top(), idle, 'a long phrase stays on one line and moves nothing');
    expect(one < 24, 'the interim line is one line high: ' + one);
    await emit(page, 0, [['Why does the derivative of x squared equal two x', true]]);
    await page.evaluate(() => window.__silence());
    await page.waitForTimeout(200);
    same(await top(), idle, 'ending moves nothing');
    await noShift(page);
    await context.close();
  });

  for (const [code, wanted] of [['not-allowed', /Allow the mic in your browser/], ['no-speech', /Didn't hear that/], ['network', /No connection/], ['audio-capture', /No microphone found/]]) {
    await check(`${label}: a ${code} error says so in the line under the box and ends listening`, async () => {
      const { context, page } = await open(browser, prefixed);
      await mic(page).click();
      await page.evaluate(name => window.__error(name), code);
      await page.waitForTimeout(150);
      const message = await page.evaluate(() => document.querySelector('.dictation-slot [role=alert]')?.textContent || '');
      expect(wanted.test(message), 'the line says ' + JSON.stringify(message));
      same(await mic(page).getAttribute('aria-pressed'), 'false', 'the mic is off');
      await mic(page).click();
      same(await page.evaluate(() => document.querySelector('.dictation-slot [role=alert]')), null, 'the error goes on the next try');
      await context.close();
    });
  }

  await check(`${label}: New chat while listening stops the mic and late words do not land`, async () => {
    const { context, page } = await open(browser, prefixed);
    await mic(page).click();
    await emit(page, 0, [['first words', true], ['still', false]]);
    await page.getByRole('link', { name: /new chat/i }).first().click();
    await page.waitForTimeout(300);
    same(await mic(page).getAttribute('aria-pressed'), 'false', 'the mic is off');
    await emit(page, 0, [['first words', true], ['late words', true]]).catch(() => {});
    await page.waitForTimeout(100);
    same(await value(page), '', 'nothing lands in the new chat');
    await context.close();
  });

  await check(`${label}: the Tutor page shows the interim words and puts the words at the caret`, async () => {
    const { context, page } = await open(browser, prefixed, { url: '/tutor' });
    const input = page.locator('textarea[aria-label="Message"]');
    await page.waitForSelector('.cordia-tutor-mic', { timeout: 30000 });
    await input.fill('one two');
    await input.evaluate(element => { element.focus(); element.setSelectionRange(3, 3); });
    await page.locator('.cordia-tutor-mic').click();
    await emit(page, 0, [['hearing this', false]]);
    await page.waitForTimeout(80);
    same(await interim(page), 'hearing this', 'the interim words show under the box');
    await emit(page, 0, [['middle', true]]);
    await page.evaluate(() => window.__silence());
    await page.waitForTimeout(150);
    same(await input.inputValue(), 'one middle two', 'the words go where the caret was');
    await context.close();
  });

  await check(`${label}: at 390px the interim line stays inside the composer`, async () => {
    const { context, page } = await open(browser, prefixed, { width: 390, height: 844 });
    await mic(page).click();
    await emit(page, 0, [['Why does the derivative of x squared equal two x and how do I show it from the definition of a limit', false]]);
    await page.waitForTimeout(100);
    const fit = await page.evaluate(() => { const note = document.querySelector('.dictation-interim').getBoundingClientRect(); const form = document.querySelector('.composer').getBoundingClientRect(); return { inside: note.left >= form.left && note.right <= form.right + 1, scroll: document.documentElement.scrollWidth <= window.innerWidth }; });
    expect(fit.inside && fit.scroll, 'the line wraps inside the composer, no sideways scroll ' + JSON.stringify(fit));
    await context.close();
  });

  // The study aid and the Tutor drawer hold the same line. A long phrase must not widen what holds it,
  // and an error is one line that stays until the next mic press or a keystroke.
  const LONG = 'Why does the derivative of x squared equal two x and how do I show it from the definition of a limit step by step please and then what';
  // Layout shift from `scope` (a selector) only: other things on a guide page (a tip that arrives after a few seconds) are not the line's.
  const watch = startShiftScore;
  const lineHeight = page => page.evaluate(() => document.querySelector('.dictation-slot [role=alert], .dictation-slot .dictation-interim')?.getBoundingClientRect().height || 0);
  const aidRoutes = async page => {
    await page.route(/localhost:8000\/learning-style/, route => route.fulfill({ json: { enabled: true, style: 'aural' } }));
    await page.route(/localhost:8000\/study-aids$/, route => route.fulfill({ json: { mode: 'aural', script: 'Concept one is an idea explained in plain words.', task: 'Explain concept one to a friend in your own words.' } }));
  };
  const openAid = async (width, height) => {
    const opened = await open(browser, prefixed, { width, height, url: state => `/guide/${state.guides[0].id}?learn=1`, before: aidRoutes });
    await opened.page.getByText('By page', { exact: true }).click({ timeout: 90000 });
    await opened.page.waitForSelector('.study-aid-attempt textarea', { timeout: 60000 });
    await opened.page.waitForTimeout(2500);
    await opened.page.locator('.study-aid-attempt textarea').scrollIntoViewIfNeeded();
    await opened.page.waitForTimeout(400);
    return opened;
  };
  const sayIt = page => page.evaluate(() => [...document.querySelectorAll('.study-aid-attempt .study-aid-actions button')].find(button => /Say it|Stop/.test(button.textContent)).click());
  const aidBox = page => page.evaluate(() => { const rect = selector => { const element = document.querySelector(selector); return element ? [element.getBoundingClientRect().left, element.getBoundingClientRect().width, element.getBoundingClientRect().height].map(Math.round).join('x') : null; }; const slot = document.querySelector('.study-aid-attempt .dictation-slot'); const slotRect = slot ? slot.getBoundingClientRect() : null; return { panel: rect('.study-aid-panel'), textarea: rect('.study-aid-attempt textarea'), slot: slotRect ? [slotRect.left, slotRect.top, slotRect.width, slotRect.height].map(Math.round).join('x') : null, scroll: document.documentElement.scrollWidth }; });

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await check(`${label}: study aid at ${width}px, a long interim phrase leaves the panel as wide as before (shift score 0 where reported)`, async () => {
      const { context, page } = await openAid(width, height);
      await watch(page, '.study-aid-panel');
      const idle = await aidBox(page);
      await sayIt(page);
      await page.waitForTimeout(300);
      same(JSON.stringify(await aidBox(page)), JSON.stringify(idle), 'listening changes no width');
      await emit(page, 0, [[LONG, false]]);
      await page.waitForTimeout(250);
      same(JSON.stringify(await aidBox(page)), JSON.stringify(idle), 'a long interim phrase changes no width');
      expect((await lineHeight(page)) < 24, 'the phrase stays one line high');
      await emit(page, 0, [['Concept one is plain words', true]]);
      await page.evaluate(() => window.__silence());
      await page.waitForTimeout(300);
      same(JSON.stringify(await aidBox(page)), JSON.stringify(idle), 'ending changes no width');
      await noShift(page);
      await context.close();
    });
  }

  await check(`${label}: study aid at 390px, the error is one line and nothing moves when it comes or goes (shift score 0 where reported)`, async () => {
    const { context, page } = await openAid(390, 844);
    await watch(page, '.study-aid-panel');
    const idle = await aidBox(page);
    await sayIt(page);
    await page.evaluate(() => window.__error('not-allowed'));
    await page.waitForTimeout(300);
    expect((await lineHeight(page)) < 24, 'the error is one line high: ' + (await lineHeight(page)));
    same(JSON.stringify(await aidBox(page)), JSON.stringify(idle), 'the error moves nothing');
    await page.waitForTimeout(8600); // longer than the old timer: it stays until the student acts
    same(await page.evaluate(() => Boolean(document.querySelector('.dictation-slot [role=alert]'))), true, 'the error is still there after 8.6 s');
    await page.locator('.study-aid-attempt textarea').click();
    await page.keyboard.type('a');
    await page.waitForTimeout(200);
    same(await page.evaluate(() => document.querySelector('.dictation-slot [role=alert]')), null, 'a keystroke clears it');
    same(JSON.stringify((await aidBox(page)).panel), JSON.stringify(idle.panel), 'clearing it moves nothing');
    await noShift(page);
    await context.close();
  });

  // The study aid's line is the narrowest place an error shows: 212px at a 360px viewport, 242px at 390px.
  // Every message must be whole in it (no ellipsis, nothing scrolled off), one line, with nothing moving.
  for (const width of [360, 390]) {
    await check(`${label}: study aid at ${width}px, every error message fits its line whole (no ellipsis), and nothing moves`, async () => {
      const { context, page } = await openAid(width, 844);
      await watch(page, '.study-aid-panel');
      const idle = await aidBox(page);
      const widths = [];
      for (const code of ['not-allowed', 'service-not-allowed', 'no-speech', 'network', 'audio-capture', 'something-new']) {
        await sayIt(page);
        await page.waitForTimeout(150);
        await page.evaluate(name => window.__error(name), code);
        await page.waitForTimeout(250);
        const line = await page.evaluate(() => {
          const element = document.querySelector('.study-aid-attempt .dictation-slot [role=alert]');
          if (!element) return null;
          const range = document.createRange(); range.selectNodeContents(element);
          return { text: element.textContent, room: element.clientWidth, needs: element.scrollWidth, text_width: Math.round(range.getBoundingClientRect().width), height: element.getBoundingClientRect().height, overflow: getComputedStyle(element).textOverflow };
        });
        expect(line, `${code}: an error line is showing`);
        widths.push(`${code}=${line.text_width}/${line.room}px`);
        expect(line.needs <= line.room, `${code} is cut off: ${JSON.stringify(line)}`);
        expect(line.text_width <= line.room, `${code} is wider than its line: ${JSON.stringify(line)}`);
        expect(line.height < 24, `${code} is one line high: ${line.height}`);
        same(JSON.stringify(await aidBox(page)), JSON.stringify(idle), `${code} moves nothing`);
        await sayIt(page); // the next press clears it
        await page.waitForTimeout(150);
        await page.evaluate(() => window.__silence && window.__silence());
        await page.waitForTimeout(100);
      }
      if (width === 360) console.log('     study aid line at 360px: ' + widths.join(' '));
      await noShift(page);
      await context.close();
    });
  }

  await check(`${label}: the fade at the left edge follows the line's width when the window is resized, not only the words`, async () => {
    const { context, page } = await open(browser, prefixed, { width: 390, height: 844 });
    await mic(page).click();
    await emit(page, 0, [['Why does the derivative of x squared equal two x and how do', false]]);
    await page.waitForTimeout(100);
    const state = () => page.evaluate(() => { const line = document.querySelector('.dictation-interim'); return { clipped: line.dataset.clipped, scrolled: line.scrollLeft > 0 }; });
    const narrow = await state();
    same(narrow.clipped + narrow.scrolled, 'truetrue', 'at 390px the phrase runs past the left edge and fades');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    const wide = await state();
    same(wide.clipped + wide.scrolled, 'falsefalse', 'at 1440px the same words fit: no fade, with the words unchanged');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const back = await state();
    same(back.clipped + back.scrolled, 'truetrue', 'narrow again: the fade returns');
    await context.close();
  });

  await check(`${label}: Tutor drawer (360px), the longest error is one line, the interim line does not widen it, shift score 0 where reported`, async () => {
    const { context, page } = await open(browser, prefixed, { url: state => `/guide/${state.guides[0].id}` });
    const bubble = page.locator('button.c-tutor-bubble');
    await bubble.waitFor({ timeout: 60000 });
    await bubble.click();
    await page.waitForSelector('#cordia-tutor-drawer .cordia-tutor-mic', { timeout: 60000 });
    await page.waitForTimeout(1200);
    // Words that land in an empty drawer box make Send appear: that is the box filling, not the line. Start with text in it.
    await page.locator('#cordia-tutor-drawer textarea').fill('Explain');
    await page.waitForTimeout(300);
    await watch(page);
    const drawer = () => page.evaluate(() => { const rect = document.querySelector('#cordia-tutor-drawer').getBoundingClientRect(); const slot = document.querySelector('#cordia-tutor-drawer .dictation-slot').getBoundingClientRect(); return `${Math.round(rect.width)} ${Math.round(slot.top)}`; });
    const idle = await drawer();
    const micButton = page.locator('#cordia-tutor-drawer .cordia-tutor-mic');
    await micButton.click();
    await emit(page, 0, [[LONG, false]]);
    await page.waitForTimeout(200);
    same(await drawer(), idle, 'a long interim phrase moves and widens nothing');
    await emit(page, 0, [['the chain rule', true]]);
    await page.evaluate(() => window.__silence());
    await page.waitForTimeout(250);
    for (const code of ['not-allowed', 'network', 'audio-capture']) {
      await micButton.click();
      await page.evaluate(name => window.__error(name), code);
      await page.waitForTimeout(250);
      const high = await lineHeight(page);
      expect(high > 0 && high < 24, `${code} is one line high in the drawer: ${high}`);
      const clipped = await page.evaluate(() => { const line = document.querySelector('#cordia-tutor-drawer .dictation-slot [role=alert]'); return line.scrollWidth > line.clientWidth; });
      expect(!clipped, `${code} is not cut off in the drawer`);
      same(await drawer(), idle, `${code} moves nothing`);
    }
    await micButton.click(); // the next press clears it
    await page.waitForTimeout(200);
    same(await page.evaluate(() => document.querySelector('#cordia-tutor-drawer .dictation-slot [role=alert]')), null, 'the next mic press clears the error');
    same(await drawer(), idle, 'clearing moves nothing');
    await noShift(page);
    await context.close();
  });

  await check(`${label}: the interim line fades at the left edge once it is scrolled, and the composer's bottom padding leaves the words 12px from the edge`, async () => {
    const { context, page } = await open(browser, prefixed);
    await mic(page).click();
    await emit(page, 0, [['Why', false]]);
    await page.waitForTimeout(100);
    same(await page.evaluate(() => document.querySelector('.dictation-interim').dataset.clipped), 'false', 'a short phrase is not faded');
    await emit(page, 0, [[LONG, false]]);
    await page.waitForTimeout(100);
    const faded = await page.evaluate(() => { const line = document.querySelector('.dictation-interim'); const style = getComputedStyle(line); return { clipped: line.dataset.clipped, mask: style.maskImage || style.webkitMaskImage, scrolled: line.scrollLeft > 0 }; });
    expect(faded.clipped === 'true' && faded.scrolled && /gradient/.test(faded.mask), 'a long phrase fades on the left: ' + JSON.stringify(faded));
    const gap = await page.evaluate(() => { const line = document.querySelector('.dictation-interim'); const range = document.createRange(); range.selectNodeContents(line); const text = range.getBoundingClientRect(); const composer = document.querySelector('.composer').getBoundingClientRect(); return { padding: getComputedStyle(document.querySelector('.composer')).paddingBottom, below: Math.round((composer.bottom - text.bottom) * 10) / 10 }; });
    same(gap.padding, '11px', 'bottom padding while the line shows');
    expect(gap.below >= 11.5 && gap.below <= 13, 'the words end about 12px from the composer edge: ' + gap.below);
    await context.close();
  });
  await browser.close();
}

(async () => {
  await suite('chromium', chromium, false);
  await suite('webkit', webkit, true);
  const failed = results.filter(result => !result).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
