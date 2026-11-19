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

const box = page => page.locator('.composer-box');
const value = page => box(page).inputValue();
const interim = page => page.evaluate(() => document.querySelector('.dictation-interim')?.textContent || null);
const emit = (page, index, rows) => page.evaluate(([i, r]) => window.__emit(i, r), [index, rows]);
const mic = page => page.locator('button.composer-icon[aria-label*="isten"], button.composer-icon[aria-label*="Talk"]');

async function open(browser, prefixed, { width = 1440, height = 900, url = '/home' } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(FAKE(prefixed));
  await install(context, createState(true));
  const page = await context.newPage();
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
  return { context, page, problems };
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

  await check(`${label}: the composer does not move when the line fills, wraps or empties (0 px, CLS 0)`, async () => {
    const { context, page } = await open(browser, prefixed);
    await page.evaluate(() => { window.__cls = 0; new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__cls += entry.value; }).observe({ type: 'layout-shift', buffered: false }); });
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
    same(await page.evaluate(() => window.__cls), 0, 'layout shift score');
    await context.close();
  });

  for (const [code, wanted] of [['not-allowed', /blocking the microphone.*site settings/], ['no-speech', /Didn't catch anything/], ['network', /connect/]]) {
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
  await browser.close();
}

(async () => {
  await suite('chromium', chromium, false);
  await suite('webkit', webkit, true);
  const failed = results.filter(result => !result).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
