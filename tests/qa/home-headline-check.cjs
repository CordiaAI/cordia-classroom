// The home headline by class picker (FEEDBACK-BATCH-1 H1) in a real browser against a local dev
// server and the mock API: each branch, the 150ms cross-fade (instant with reduced motion), the
// column's place, fit at 1440, 1024 and 390 and at Larger text, and contrast in light, dark and
// Paper & Clay. Run the app on the port first:
//   npm run dev --prefix web -- -p 3117
//   BASE=http://localhost:3117 node tests/qa/home-headline-check.cjs   (OUT=dir keeps screenshots; ONLY=regex runs some checks)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3117';
const OUT = process.env.OUT ? path.resolve(process.env.OUT) : '';
const BIO = 'f0000000-0000-4000-8000-000000000001';
const BUS = 'f0000000-0000-4000-8000-000000000002';
const LIT = 'f0000000-0000-4000-8000-000000000003';
const CHM = 'f0000000-0000-4000-8000-000000000004';
const CLASSES = [['BIO 101', 'exam'], ['BUS 210', 'deadline'], ['ENG 220', 'weak'], ['CHM 110', 'class']];
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n').slice(0, 4).join(' | ').slice(0, 600)}`); }
}

const day = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return date; };
const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const at = (days, hour = 23, minute = 59) => { const date = day(days); date.setHours(hour, minute, 0, 0); return date.toISOString(); };

function seed() {
  const state = createState(true);
  state.folders = [
    { id: BIO, name: 'BIO 101: Introduction to Biology' }, { id: BUS, name: 'BUS 210: Business Ethics' },
    { id: LIT, name: 'ENG 220: American Literature' }, { id: CHM, name: 'CHM 110: General Chemistry' },
  ];
  const base = state.guides[0];
  const make = (id, title, folder, extra = {}) => ({ ...base, id: 'a0000000-0000-4000-8000-0000000001' + id, title, folder_id: folder, flashcard_progress: { known: [] }, ...extra });
  const levels = Object.fromEntries(['membrane', 'osmosis', 'symbolism', 'narrator', 'green light', 'wealth'].map((name, index) => [index, { l: index < 3 ? 1 : index === 3 ? 2 : 3, at: key(day(index < 2 ? -1 : -3)), q: `what is ${name}` }]));
  state.guides = [
    make('01', 'Exam 3: review', BIO),
    make('02', 'Packback prep', BUS),
    make('03', 'The Great Gatsby: Themes and Symbols', LIT, { flashcard_progress: { learn: { levels } } }),
    make('04', 'Stoichiometry basics', CHM),
  ];
  return state;
}

async function open(browser, { width = 1440, height = 900, theme = 'light', reduced = false, look = '', size = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const state = seed();
  await install(context, state);
  await context.route(/localhost:8000\/calendar\/coursework/, route => route.fulfill({ json: { connected: true, counts: { upcoming: 2, missing: 0, completed: 0 }, missing: [], completed: [], upcoming: [
    { id: 'canvas-1', title: 'Exam 3', course: 'BIO-101-002', due_at: at(2, 10, 0), type: 'exam', done: false },
    { id: 'canvas-2', title: 'A05 Packback Discussion: Seven Ethical Frameworks and the Case for Stakeholder Theory', course: 'BUS-210-004', due_at: at(2), type: 'assignment', done: false, points: 50, url: 'https://school.instructure.com/courses/1/assignments/2' },
  ] } }));
  await context.route(/localhost:8000\/calendar\/connection/, route => route.fulfill({ json: { connected: false } }));
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, mode]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', mode); }, [TOKEN, USER, theme]);
  await page.goto(BASE + '/home');
  await page.waitForSelector('.chat-home-headline', { timeout: 60000 });
  await page.waitForTimeout(900);
  if (look || size) await page.evaluate(([lookName, sizeName]) => { const root = document.documentElement; if (lookName) { root.setAttribute('data-look', lookName); root.setAttribute('data-glass', 'solid'); } if (sizeName) root.setAttribute('data-size', sizeName); }, [look, size]);
  await page.waitForTimeout(200);
  return { context, page, state, problems };
}

const hero = page => page.evaluate(() => {
  const headlines = [...document.querySelectorAll('.chat-home-headline')].filter(node => !node.closest('[aria-hidden="true"]'));
  const line = document.querySelector('.chat-home-copy:not(.is-leaving) .chat-home-line');
  return { title: headlines[0]?.textContent || '', line: line?.textContent || '', copies: document.querySelectorAll('.chat-home-headline').length };
});
const geometry = page => page.evaluate(() => {
  const box = selector => { const node = document.querySelector(selector); if (!node) return null; const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height }; };
  const headline = [...document.querySelectorAll('.chat-home-copy:not(.is-leaving) .chat-home-headline')][0];
  const range = document.createRange();
  range.selectNodeContents(headline);
  const text = range.getBoundingClientRect();
  return {
    composer: box('.chat-home-composer'), hero: box('.chat-home-hero'), pills: box('.chat-home-pills'), headline: { top: text.top, bottom: text.bottom, left: text.left, right: text.right, lines: Math.round(text.height / parseFloat(getComputedStyle(headline).lineHeight)) },
    overflowX: document.documentElement.scrollWidth - innerWidth, width: innerWidth,
    heroOverflow: Math.max(...[...document.querySelectorAll('.chat-home-hero, .chat-home-hero *')].map(node => node.scrollWidth - node.clientWidth)),
  };
});
async function pick(page, code) {
  await page.locator('.chat-home-top .c-class-picker').click();
  await page.getByRole('menuitem', { name: new RegExp(code) }).click();
}
const shot = async (page, name) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, name + '.png') }); } };

// Contrast of the hero's text against the pixels behind it (the page with all text made transparent).
async function contrast(page) {
  const items = await page.evaluate(() => [...document.querySelectorAll('.chat-home-copy:not(.is-leaving) :is(h1, p)')].map(node => {
    const range = document.createRange(); range.selectNodeContents(node); const rect = range.getBoundingClientRect(); const style = getComputedStyle(node);
    return { label: node.textContent.slice(0, 30), color: style.color, size: parseFloat(style.fontSize), bold: Number(style.fontWeight) >= 700, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
  }));
  const hide = await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }' });
  await page.waitForTimeout(80);
  const png = (await page.screenshot({ type: 'png' })).toString('base64');
  await hide.evaluate(node => node.remove());
  return page.evaluate(async ({ png, items }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const scale = img.width / innerWidth;
    const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    return items.map(item => {
      const x = Math.max(0, Math.floor(item.rect.x * scale)); const y = Math.max(0, Math.floor(item.rect.y * scale));
      const w = Math.max(1, Math.min(canvas.width - x, Math.floor(item.rect.w * scale))); const h = Math.max(1, Math.min(canvas.height - y, Math.floor(item.rect.h * scale)));
      const data = ctx.getImageData(x, y, w, h).data;
      const parts = item.color.match(/[\d.]+/g).map(Number); const alpha = parts.length > 3 ? parts[3] : 1;
      // The worst pixel, not the middle one: the backdrop has soft light and dark patches.
      let worst = Infinity;
      for (let i = 0; i < data.length; i += 16) {
        const bg = [data[i], data[i + 1], data[i + 2]];
        worst = Math.min(worst, ratio([0, 1, 2].map(k => parts[k] * alpha + bg[k] * (1 - alpha)), bg));
      }
      return { label: item.label, ratio: worst, need: item.size >= 24 || (item.size >= 18.66 && item.bold) ? 3 : 4.5 };
    });
  }, { png, items });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--headless=new'] });

  await check('All classes: a greeting with the first name, nothing under it', async () => {
    const { page, problems, context } = await open(browser);
    const { title, line } = await hero(page);
    expect(/^(Good (morning|afternoon|evening), Test|Up late, Test\?|What's on your mind, Test\?|Ready when you are, Test)$/.test(title), `greeting: ${title}`);
    expect(line === '', `line: ${line}`);
    await page.reload(); await page.waitForSelector('.chat-home-headline'); await page.waitForTimeout(600);
    expect((await hero(page)).title === title, 'the same greeting after a reload');
    expect(problems.length === 0, problems.join(' | '));
    await shot(page, 'all-1440-light');
    await context.close();
  });

  const expected = {
    exam: ({ title, line }) => /^(Today|Tomorrow|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) is your Introduction to Biology exam\.$/.test(title) && /ideas? left to master\. \d+ today keeps you on pace\.$/.test(line),
    deadline: ({ title, line }) => /^Packback discussion for BUS 210 is due (Friday|Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday)\.$/.test(title) && /^Due \w+ at 11:59 PM$/.test(line),
    weak: ({ title, line }) => title === 'Want another look at The Great Gatsby: Themes and Symbols?' && /^\d+% ready in ENG 220$/.test(line),
    class: ({ title, line }) => /^(What's next in General Chemistry\?|Picking up General Chemistry\?|Where were we in General Chemistry\?|Let's work on General Chemistry)$/.test(title) && line === '',
  };
  for (const [width, label] of [[1440, '1440'], [1024, '1024'], [390, '390']]) {
    await check(`${label}: each branch reads right, fits, and the column keeps its place`, async () => {
      const { page, problems, context } = await open(browser, { width, height: width < 600 ? 844 : 900 });
      const places = [];
      for (const [code, branch] of CLASSES) {
        await pick(page, code);
        await page.waitForTimeout(350);
        const words = await hero(page);
        expect(expected[branch](words), `${branch}: ${JSON.stringify(words)}`);
        expect(words.copies === 1, `copies ${words.copies}`);
        const g = await geometry(page);
        expect(g.heroOverflow <= 0, `${branch}: the headline overflows its column by ${g.heroOverflow}`);
        expect(g.headline.right <= g.width - 8 && g.headline.left >= 0, `${branch}: headline outside the screen`);
        expect(g.headline.bottom <= g.composer.top, `${branch}: headline runs into the composer`);
        places.push([branch, Math.round(g.composer.top), g.headline.lines, Math.round(g.hero.height)]);
        await shot(page, `${branch}-${label}-light`);
      }
      await pick(page, 'All classes');
      await page.waitForTimeout(350);
      places.push(['all', Math.round((await geometry(page)).composer.top)]);
      console.log(`     composer top / headline lines / hero height by branch at ${label}: ${JSON.stringify(places)}`);
      const tops = new Set(places.map(item => item[1]));
      expect(tops.size === 1, `the composer moves between branches: ${[...tops].join(', ')}`);
      expect(problems.length === 0, problems.join(' | '));
      await context.close();
    });
  }

  await check('Larger text: 1440 and 390 fit and keep the composer in place', async () => {
    for (const width of [1440, 390]) {
      const { page, context } = await open(browser, { width, height: width < 600 ? 844 : 900, size: 'larger' });
      const tops = new Set();
      for (const [code, branch] of [['All classes', 'all'], ...CLASSES]) {
        await pick(page, code);
        await page.waitForTimeout(350);
        const g = await geometry(page);
        expect(g.heroOverflow <= 0 && g.headline.right <= g.width - 8, `${width} ${branch}: does not fit`);
        expect(g.headline.bottom <= g.composer.top, `${width} ${branch}: runs into the composer`);
        tops.add(Math.round(g.composer.top));
        await shot(page, `${branch}-${width}-larger`);
      }
      expect(tops.size === 1, `${width}: the composer moves at Larger: ${[...tops].join(', ')}`);
      await context.close();
    }
  });

  await check('a class change cross-fades over 150ms: both copies for a moment, the old one hidden from assistive tech', async () => {
    const { page, context } = await open(browser);
    await page.locator('.chat-home-top .c-class-picker').click();
    await page.evaluate(() => { window.__during = null; new MutationObserver(() => { const all = [...document.querySelectorAll('.chat-home-headline')]; if (all.length === 2 && !window.__during) window.__during = all.map(node => [node.textContent, Boolean(node.closest('[aria-hidden="true"]')), node.closest('.chat-home-copy').className]); }).observe(document.body, { childList: true, subtree: true }); });
    await page.getByRole('menuitem', { name: /BIO 101/ }).click();
    await page.waitForTimeout(60);
    const during = await page.evaluate(() => window.__during);
    expect(during && during.length === 2, 'two copies during the fade: ' + JSON.stringify(during));
    expect(during.filter(item => item[1]).length === 1 && during.some(item => item[2].includes('is-leaving')) && during.some(item => item[2].includes('is-entering')), JSON.stringify(during));
    const animation = await page.evaluate(() => [...document.querySelectorAll('.chat-home-copy')].map(node => getComputedStyle(node).animationDuration));
    expect(animation.every(value => value === '0.15s'), 'durations ' + animation);
    await page.waitForTimeout(300);
    expect((await hero(page)).copies === 1, 'one copy after the fade');
    await context.close();
  });

  await check('reduced motion: the words change at once, with no second copy and no animation', async () => {
    const { page, context } = await open(browser, { reduced: true });
    await page.locator('.chat-home-top .c-class-picker').click();
    await page.getByRole('menuitem', { name: /ENG 220/ }).click();
    await page.waitForTimeout(40);
    const words = await hero(page);
    expect(words.copies === 1 && expected.weak(words), JSON.stringify(words));
    const animation = await page.evaluate(() => getComputedStyle(document.querySelector('.chat-home-copy')).animationName);
    expect(animation === 'none', 'animation ' + animation);
    await context.close();
  });

  await check('a class change asks the server for nothing', async () => {
    const { page, state, context } = await open(browser);
    const before = state.calls.length;
    for (const [code] of CLASSES) { await pick(page, code); await page.waitForTimeout(250); }
    await pick(page, 'All classes');
    await page.waitForTimeout(400);
    const made = state.calls.slice(before).filter(call => !/\/auth\/me|\/folders/.test(call));
    expect(made.length === 0, 'requests after picking: ' + made.join(', '));
    await context.close();
  });

  await check('the composer\'s own picker changes the headline too, and a class link opens with its headline', async () => {
    const { page, context } = await open(browser);
    await page.locator('.composer .c-class-picker').first().click();
    await page.getByRole('menuitem', { name: /CHM 110/ }).click();
    await page.waitForTimeout(350);
    expect(expected.class(await hero(page)), JSON.stringify(await hero(page)));
    await page.goto(`${BASE}/home?class=${BUS}`);
    await page.waitForSelector('.chat-home-headline');
    await page.waitForTimeout(900);
    expect(expected.deadline(await hero(page)), JSON.stringify(await hero(page)));
    await context.close();
  });

  for (const [theme, look, name] of [['light', '', 'light'], ['dark', '', 'dark'], ['light', 'paper-clay', 'paper-clay'], ['dark', 'paper-clay', 'paper-clay dark']]) {
    for (const width of [1440, 390]) {
      await check(`contrast, ${name}, ${width}: every headline and line is at least 4.5:1 on what is behind it`, async () => {
        const { page, context } = await open(browser, { width, height: width < 600 ? 844 : 900, theme, look });
        const bad = [];
        let lowest = Infinity;
        for (const [code] of [['All classes'], ...CLASSES]) {
          await pick(page, code);
          await page.waitForTimeout(350);
          (await contrast(page)).forEach(item => { lowest = Math.min(lowest, item.ratio); if (item.ratio < item.need) bad.push(`${code}: ${item.ratio.toFixed(2)}:1 "${item.label}"`); });
          if (code === 'BIO 101' || code === 'All classes') await shot(page, `${code.replace(/ /g, '-')}-${width}-${name.replace(/ /g, '-')}`);
        }
        console.log(`     lowest ${lowest.toFixed(2)}:1 over the greeting and each branch`);
        expect(bad.length === 0, bad.join(' | '));
        await context.close();
      });
    }
  }

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed.`);
  process.exit(failed ? 1 : 0);
})();
