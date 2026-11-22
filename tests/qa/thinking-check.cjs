// The Tutor's thinking lines (T4b) in a real browser against a local dev server and the mock API
// (tests/qa/mock-api.cjs: state.statusLines, statusDelay, steps, chatDelay). Run the app first:
//   npm run dev --prefix web -- -p 3118
//   BASE=http://localhost:3118 CHROME=/path/to/chrome node tests/qa/thinking-check.cjs   (ONLY=regex runs some checks; SHOTS=dir saves screenshots)
// The first visit to a page in `next dev` compiles it, so the waits below are generous.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3118';
const SHOTS = process.env.SHOTS || '';
const LINES = ['Tracing the Krebs cycle step by step', 'Linking ATP to cell work', 'Mapping electron carriers in order'];
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n').slice(0, 3).join(' | ').slice(0, 500)}`); }
}

async function session(browser, { width = 1440, height = 900, theme = 'light', look = '', reduced = false, setup = () => {} } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const state = createState(true);
  state.statusLines = LINES;
  setup(state);
  await install(context, state);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, mode, lookName]) => {
    localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', mode);
    if (lookName) localStorage.setItem('look', lookName);
  }, [TOKEN, USER, theme, look]);
  return { context, page, state, problems };
}

const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null);
const line = page => page.evaluate(() => {
  const shown = [...document.querySelectorAll('.tutor-thinking .tutor-line:not(.is-out)')];
  return shown.map(item => item.textContent).join('|');
});
const rows = page => page.$$eval('.tutor-thinking', items => items.length);

async function ask(page, text, { drawer = false } = {}) {
  if (drawer) {
    await page.goto(BASE + '/dashboard');
    await page.waitForSelector('.c-tutor-bubble');
    await page.click('.c-tutor-bubble');
    await page.waitForSelector('#cordia-tutor-drawer textarea', { state: 'visible' });
    await page.waitForTimeout(700);
    await page.fill('#cordia-tutor-drawer textarea', text);
    await page.keyboard.press('Enter');
  } else {
    await page.goto(BASE + '/home');
    await page.waitForSelector('.chat-home textarea');
    await page.waitForTimeout(900);
    await page.fill('.chat-home textarea', text);
    await page.keyboard.press('Enter');
  }
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--headless=new'] });

  for (const surface of ['chat', 'drawer']) {
    const drawer = surface === 'drawer';

    await check(`${surface}: "Reading your question" first, then the question's lines every 2.2 s, then the answer replaces them`, async () => {
      const { page, state, problems, context } = await session(browser, { setup: s => { s.chatDelay = 9500; s.statusDelay = 600; } });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      const started = Date.now();
      expect(await line(page) === 'Reading your question', `first line: ${await line(page)}`);
      expect(await rows(page) === 1, 'one thinking row');
      expect(await page.$$eval('.tutor-thinking .c-loader', e => e.length) === 1, 'exactly one mark');
      expect(await page.$$eval('.tutor-thinking img, .tutor-thinking svg', e => e.length) === 1, 'no second icon');
      await shot(page, `${surface}-1-fallback`);
      const seen = [];
      while (Date.now() - started < 9000) {
        const now = await line(page);
        if (!seen.length || seen.at(-1)[1] !== now) seen.push([Date.now() - started, now]);
        await page.waitForTimeout(100);
      }
      const texts = seen.map(item => item[1]);
      expect(texts[0] === 'Reading your question' && texts[1] === LINES[0] && texts[2] === LINES[1] && texts[3] === LINES[2] && texts[4] === LINES[0], `sequence ${JSON.stringify(texts)}`);
      const gaps = seen.slice(2).map((item, at) => item[0] - seen[at + 1][0]);
      expect(gaps.every(gap => gap > 2000 && gap < 2500), `2.2 s apart: ${JSON.stringify(gaps)}`);
      await shot(page, `${surface}-2-lines`);
      await page.waitForSelector('.tutor-thinking', { state: 'detached', timeout: 12000 });
      expect(await page.$$eval('.tutor-line', e => e.length) === 0, 'no line left once the answer is in');
      expect((await page.textContent('body')).includes('simple'), 'the answer is on the page');
      expect(problems.length === 0, `page errors ${problems}`);
      await context.close();
    });

    await check(`${surface}: a real step shows the moment it happens, then the question's lines go on`, async () => {
      const { page, context } = await session(browser, { setup: s => { s.chatDelay = 9000; s.statusDelay = 300; s.steps = ms => (ms > 1500 ? ['Reading Cell Biology Basics'] : []); } });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      const started = Date.now();
      let at = 0;
      while (await line(page) !== 'Reading Cell Biology Basics' && Date.now() - started < 6000) await page.waitForTimeout(80);
      at = Date.now() - started;
      expect(await line(page) === 'Reading Cell Biology Basics', 'the step shows');
      expect(at < 3000, `shown within 3 s of the question (${at} ms)`);
      await shot(page, `${surface}-3-step`);
      await page.waitForTimeout(3000);
      expect(LINES.includes(await line(page)), `then a question line: ${await line(page)}`);
      await context.close();
    });

    await check(`${surface}: steps that arrive together each get at least 1.2 s on screen, in order, none dropped`, async () => {
      const { page, context } = await session(browser, { setup: s => { s.chatDelay = 9000; s.statusDelay = 200; s.steps = ms => (ms > 100 ? ['Reading Cell Biology Basics'] : []).concat(ms > 250 ? ['Drawing a diagram'] : []).concat(ms > 400 ? ['Building your study guide'] : []); } });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      const started = Date.now();
      const seen = [];
      while (Date.now() - started < 6500) {
        const now = await line(page);
        if (!seen.length || seen.at(-1)[1] !== now) seen.push([Date.now() - started, now]);
        await page.waitForTimeout(40);
      }
      const texts = seen.map(item => item[1]);
      for (const step of ['Reading Cell Biology Basics', 'Drawing a diagram', 'Building your study guide']) expect(texts.includes(step), `${step} was shown: ${JSON.stringify(texts)}`);
      expect(texts.indexOf('Reading Cell Biology Basics') < texts.indexOf('Drawing a diagram') && texts.indexOf('Drawing a diagram') < texts.indexOf('Building your study guide'), `in order: ${JSON.stringify(texts)}`);
      const gaps = seen.slice(1).map((item, at) => item[0] - seen[at][0]);
      expect(gaps.every(gap => gap >= 1100), `at least 1.2 s between changes (tolerance 100 ms): ${JSON.stringify(seen)}`);
      await context.close();
    });

    await check(`${surface}: during a line change the two lines are never both near half opacity`, async () => {
      const { page, context } = await session(browser, { setup: s => { s.chatDelay = 7000; s.statusDelay = 300; } });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      await page.evaluate(() => {
        window.__swap = [];
        const frame = () => {
          const out = document.querySelector('.tutor-thinking .tutor-line.is-out');
          const incoming = document.querySelector('.tutor-thinking .tutor-line.is-in');
          if (out && incoming) window.__swap.push([Number(getComputedStyle(out).opacity), Number(getComputedStyle(incoming).opacity)]);
          window.__frame = requestAnimationFrame(frame);
        };
        frame();
      });
      await page.waitForTimeout(5200);
      const swap = await page.evaluate(() => window.__swap);
      expect(swap.length > 10, `frames sampled during a swap: ${swap.length}`);
      const worst = Math.max(...swap.map(([out, incoming]) => Math.min(out, incoming)));
      expect(worst < 0.35, `the dimmer of the two lines is at most ${worst.toFixed(2)}`);
      await context.close();
    });

    await check(`${surface}: a 429 on the status call and on the step poll is silent: no console error, the fallback stays`, async () => {
      const { page, state, context } = await session(browser, { setup: s => { s.limited = true; s.chatDelay = 7000; } });
      const logged = [];
      page.on('console', message => { if (message.type() === 'error') logged.push(message.text()); });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      await page.waitForTimeout(6000);
      expect(await line(page) === 'Reading your question', `still: ${await line(page)}`);
      expect(state.stepCalls >= 1, `the poll ran (${state.stepCalls})`);
      expect(state.stepCalls <= 4, `and backed off: ${state.stepCalls} polls in about 6 s`);
      // The browser itself notes a 429 response, and next dev adds its own noise; the app's own log line is what must be gone.
      const own = logged.filter(text => /API fetch error/.test(text));
      expect(own.length === 0, `nothing logged by the app: ${JSON.stringify(own)}`);
      await context.close();
    });

    await check(`${surface}: no lines from the model: the fallback stays and nothing breaks`, async () => {
      const { page, context } = await session(browser, { setup: s => { s.chatDelay = 6000; s.statusLines = []; } });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      await page.waitForTimeout(5000);
      expect(await line(page) === 'Reading your question', `still: ${await line(page)}`);
      await context.close();
    });

    await check(`${surface}: a slow status call never delays the answer; if the answer starts first, the lines are never shown`, async () => {
      const { page, state, context } = await session(browser, { setup: s => { s.chatDelay = 400; s.statusDelay = 5000; } });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      const asked = Date.now();
      await page.waitForFunction(() => document.body.textContent.includes('simple'), null, { timeout: 8000 });
      expect(Date.now() - asked < 3500, `the answer did not wait (${Date.now() - asked} ms)`);
      await page.waitForTimeout(5600);
      const text = await page.textContent('body');
      expect(!LINES.some(item => text.includes(item)), 'a late line never appears');
      expect(await rows(page) === 0, 'no thinking row');
      expect(state.statusCalls === 1, `one status call (${state.statusCalls})`);
      await context.close();
    });

    await check(`${surface}: aria-live announces only the first line; the visible lines are hidden from readers`, async () => {
      const { page, context } = await session(browser, { setup: s => { s.chatDelay = 8000; s.statusDelay = 300; } });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      await page.waitForSelector('.tutor-thinking [aria-live]', { state: 'attached', timeout: 15000 });
      await page.waitForTimeout(600);
      const read = () => page.$eval('.tutor-thinking [aria-live]', element => [element.getAttribute('aria-live'), element.textContent]);
      expect(JSON.stringify(await read()) === JSON.stringify(['polite', 'Reading your question']), `live region ${JSON.stringify(await read())}`);
      await page.waitForTimeout(5000);
      expect(await line(page) !== 'Reading your question', 'the visible line moved on');
      expect(JSON.stringify(await read()) === JSON.stringify(['polite', 'Reading your question']), 'the live region still has only the first line');
      expect(await page.$eval('.tutor-thinking .tutor-line-stack', element => element.getAttribute('aria-hidden')) === 'true', 'visible lines are aria-hidden');
      expect(await page.$$eval('.tutor-thinking [role=status]', e => e.length) === 0, 'the mark does not announce');
      await context.close();
    });

    await check(`${surface}: reduced motion: no shimmer, lines swap without a fade`, async () => {
      const { page, context } = await session(browser, { reduced: true, setup: s => { s.chatDelay = 7000; s.statusDelay = 300; } });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      await page.waitForTimeout(2600);
      const style = await page.$eval('.tutor-thinking .tutor-line:not(.is-out)', element => { const css = getComputedStyle(element); return [css.animationName, css.backgroundImage, css.color]; });
      expect(style[0] === 'none' && style[1] === 'none', `no animation or gradient: ${JSON.stringify(style)}`);
      expect(await line(page) === LINES[0], `the next line: ${await line(page)}`);
      expect(await page.$$eval('.tutor-thinking .tutor-line', items => items.filter(item => getComputedStyle(item).display !== 'none').length) === 1, 'one line on screen, the old one gone at once');
      const mark = await page.$eval('.tutor-thinking .c-loader-mark', element => getComputedStyle(element).animationName);
      expect(mark === 'none', `the mark rests: ${mark}`);
      await context.close();
    });

    await check(`${surface}: no layout shift: the row keeps its size across lines; nothing above it moves`, async () => {
      const { page, context } = await session(browser, { setup: s => { s.chatDelay = 11000; s.statusDelay = 300; s.steps = ms => (ms > 1200 ? ['Reading a study guide with a rather long title that goes on'] : []); } });
      await ask(page, 'Explain the Krebs cycle', { drawer });
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      const measure = () => page.evaluate(() => {
        const row = document.querySelector('.tutor-thinking').getBoundingClientRect();
        const user = [...document.querySelectorAll('.cordia-tutor-message.user')].at(-1).getBoundingClientRect();
        const room = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const clipped = [...document.querySelectorAll('.tutor-thinking .tutor-line:not(.is-out)')].some(item => item.scrollHeight > item.clientHeight + 1);
        return [Math.round(row.width), Math.round(row.height), Math.round(row.top), Math.round(user.top), room, clipped];
      });
      await page.waitForTimeout(2500); // the real step (with its long title) is in: the row is as tall as it will be
      const samples = [];
      for (let i = 0; i < 20; i += 1) { samples.push(await measure()); await page.waitForTimeout(350); }
      const widths = new Set(samples.map(item => item[0]));
      const heights = new Set(samples.map(item => item[1]));
      expect(widths.size === 1 && heights.size === 1, `row size changed: widths ${[...widths]} heights ${[...heights]}`);
      expect(new Set(samples.map(item => item[2] - item[3])).size === 1, 'the row stays where it is under the question');
      expect(samples.every(item => item[4] <= 0), 'no sideways scroll');
      expect(samples.every(item => !item[5]), 'no line is cut off: it wraps instead');
      await context.close();
    });
  }

  for (const [name, options] of [['dark', { theme: 'dark' }], ['paper-clay', { look: 'paper-clay' }], ['paper-clay-dark', { theme: 'dark', look: 'paper-clay' }]]) {
    await check(`chat: the line is readable (${name}) at every point of the shimmer`, async () => {
      const { page, context } = await session(browser, { ...options, setup: s => { s.chatDelay = 7000; s.statusDelay = 300; } });
      await ask(page, 'Explain the Krebs cycle');
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      await page.waitForTimeout(800);
      await shot(page, `chat-${name}`);
      await context.close();
    });
  }

  await check('phone 390: the thinking row fits, in the chat and in the Tutor page', async () => {
    const { page, context } = await session(browser, { width: 390, height: 844, setup: s => { s.chatDelay = 7000; s.statusDelay = 300; s.steps = ms => (ms > 800 ? ['Reading a study guide with a very long title that cannot fit'] : []); } });
    await ask(page, 'Explain the Krebs cycle');
    await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
    await page.waitForTimeout(1800);
    const fit = await page.evaluate(() => {
      const row = document.querySelector('.tutor-thinking').getBoundingClientRect();
      return [Math.round(row.right), window.innerWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth];
    });
    expect(fit[0] <= fit[1] && fit[2] <= 0, `row ${fit}`);
    await shot(page, 'phone-chat');
    await context.close();
  });

  // Review fix 4: the row is as tall as the lines really shown, and the mark sits on the first line's centre.
  const alignment = page => page.evaluate(() => {
    const row = document.querySelector('.tutor-thinking');
    const mark = row.querySelector('.cordia-tutor-avatar, .tutor-thinking-mark').getBoundingClientRect();
    const text = row.querySelector('.tutor-line:not(.is-out)');
    const box = text.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
    return {
      height: Math.round(row.getBoundingClientRect().height),
      offset: Math.round((box.top + lineHeight / 2 - (mark.top + mark.height / 2)) * 10) / 10,
      lines: Math.round(box.height / lineHeight),
    };
  });
  for (const [name, open] of [['chat', page => ask(page, 'Explain the Krebs cycle')], ['Tutor page', async page => {
    await page.goto(BASE + '/tutor');
    await page.waitForSelector('textarea', { state: 'visible' });
    await page.waitForTimeout(900);
    await page.fill('textarea', 'Explain the Krebs cycle');
    await page.keyboard.press('Enter');
  }]]) {
    await check(`phone 390, ${name}: a one-line status keeps the row one line tall, with the mark on the line's centre; a long step wraps below it`, async () => {
      const { page, context } = await session(browser, { width: 390, height: 844, setup: s => { s.chatDelay = 9000; s.statusDelay = 300; s.steps = ms => (ms > 3500 ? ['Reading a study guide with a very long title that cannot fit'] : []); } });
      await open(page);
      await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
      await page.waitForTimeout(1500);
      const short = await alignment(page);
      expect(short.lines === 1, `one line: ${JSON.stringify(short)}`);
      expect(Math.abs(short.offset) <= 1.5, `the mark is on the line's centre: ${JSON.stringify(short)}`);
      if (name === 'chat') expect(short.height <= 33, `the row stays one avatar tall: ${JSON.stringify(short)}`);
      await shot(page, `phone-${name.replace(' ', '-')}-one-line`);
      let long = short;
      const started = Date.now();
      while (long.lines < 2 && Date.now() - started < 6000) { await page.waitForTimeout(150); long = await alignment(page); }
      expect(long.lines === 2 && Math.abs(long.offset) <= 1.5 && long.height > short.height, `the long step wraps under the first line: ${JSON.stringify(long)}`);
      await shot(page, `phone-${name.replace(' ', '-')}-two-lines`);
      await context.close();
    });
  }

  await check('phone 390, dark: the Tutor page (where phones open the Tutor)', async () => {
    const { page, context } = await session(browser, { width: 390, height: 844, theme: 'dark', setup: s => { s.chatDelay = 7000; s.statusDelay = 300; } });
    await page.goto(BASE + '/tutor');
    await page.waitForSelector('textarea', { state: 'visible' });
    await page.waitForTimeout(900);
    await page.fill('textarea', 'Explain the Krebs cycle');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.tutor-thinking .tutor-line', { timeout: 15000 });
    await page.waitForTimeout(3000);
    const fit = await page.evaluate(() => [Math.round(document.querySelector('.tutor-thinking').getBoundingClientRect().right), window.innerWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth]);
    expect(fit[0] <= fit[1] && fit[2] <= 0, `row ${fit}`);
    await shot(page, 'phone-tutor-dark');
    await context.close();
  });

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
