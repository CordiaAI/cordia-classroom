// Napkin visuals UI in a real browser against a local build. /api/visual and the stored SVG are
// mocked in the browser (the server route itself is covered by web/tests/napkin-visual.test.mjs).
//   BASE=http://localhost:3100 node tests/qa/visual-check.cjs
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp';
const G = 'a0000000-0000-4000-8000-000000000001';
const STORE = 'https://db.example.co/storage/v1/object/public/visuals/ab/';
const SVG = color => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500"><rect x="40" y="40" width="300" height="160" rx="16" fill="none" stroke="${color}" stroke-width="4"/><text x="70" y="130" font-size="36" fill="${color}">Concept</text><path d="M340 120 L560 300" stroke="${color}" stroke-width="4"/><circle cx="620" cy="340" r="80" fill="none" stroke="${color}" stroke-width="4"/></svg>`;
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n')[0].slice(0, 240)}`); }
}

async function session(browser, { width = 1440, theme = 'light', visual = 'ok', left = 6 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const state = createState(true);
  state.posts = [];
  await install(context, state);
  await context.route(/localhost:8000\/(learning\/)?(learning-style|study-aids)$/, route => {
    if (route.request().url().endsWith('learning-style')) return route.fulfill({ json: { enabled: true, style: 'visual', prompted: true } });
    return route.fulfill({ json: { mode: 'visual', caption: 'How the idea connects', mermaid: 'graph TD; A[Concept] --> B[Example]', practice_mermaid: 'graph TD; A[1] --> B[2]', blanks: [] } });
  });
  await context.route(/localhost:3100\/api\/visual$/, async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { enabled: true, plan: 'free', limit: 10, left } });
    const body = JSON.parse(req.postData() || '{}');
    state.posts.push(body);
    await new Promise(resolve => setTimeout(resolve, 700));
    if (visual === 'limit') return route.fulfill({ status: 402, json: { detail: { code: 'limit_reached', feature: 'visual', plan: 'free', limit: 10, used: 10 } } });
    if (visual === 'fallback') return route.fulfill({ json: { status: 'fallback', reason: 'timeout' } });
    return route.fulfill({ json: { status: 'ok', alt: 'Diagram: What is concept 1?', theme: body.theme, left: left - 1, limit: 10, visuals: [0, 1].map(n => ({ url: `${STORE}${'a'.repeat(64)}/${n}.svg`, width: 800, height: 500 })) } });
  });
  await context.route(/db\.example\.co\/storage\/v1\/object\/public\/visuals\//, route => route.fulfill({ body: SVG(theme === 'dark' ? '#e8ece6' : '#1f2a1c'), headers: { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' } }));
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, mode]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', mode); }, [TOKEN, USER, theme]);
  return { context, page, state };
}

async function noOverflow(page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over <= 0, `page scrolls sideways by ${over}px`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new'] });

  for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
    await check(`Guide → Explain → Diagram: three sections at ${width}px ${theme}`, async () => {
      const { context, page, state } = await session(browser, { width, theme });
      await page.goto(`${BASE}/guide/${G}`);
      await page.click('.c-pill:has-text("Cards")');
      for (let section = 0; section < 3; section += 1) {
        await page.locator('.reader-actions button:has-text("Explain")').nth(section).click();
        await page.locator('.study-aid-tab:has-text("Diagram")').click();
        const make = page.locator('.nv button:has-text("Make visual")');
        await make.waitFor({ timeout: 10000 });
        if (section === 0) expect(await page.locator('.nv .c-meta').innerText() === '6 visuals left', 'visuals left not shown');
        await make.click();
        await page.locator('.nv-frame--loading .c-loader').waitFor();
        await page.locator('.nv-image').waitFor({ timeout: 10000 });
        expect((await page.locator('.nv-dot').count()) === 2, 'no variation dots');
        const box = await page.locator('.nv-frame').boundingBox();
        const column = await page.locator('.study-aid-panel').boundingBox();
        expect(box.width <= column.width + 1, `visual ${box.width}px wider than column ${column.width}px`);
        expect(/^Diagram: /.test(await page.locator('.nv-image').getAttribute('alt')), 'no alt text');
        if (section === 0) {
          await page.locator('.nv-dot').nth(1).click();
          expect(/\/1\.svg$/.test(await page.locator('.nv-image').getAttribute('src')), 'dot did not switch variation');
          const download = page.waitForEvent('download');
          await page.locator('.nv button:has-text("SVG")').click();
          expect((await download).suggestedFilename().endsWith('.svg'), 'SVG download');
          const png = page.waitForEvent('download');
          await page.locator('.nv button:has-text("PNG")').click();
          expect((await png).suggestedFilename().endsWith('.png'), 'PNG download');
          await page.screenshot({ path: path.join(SHOTS, `visual-guide-${width}-${theme}.png`) });
        }
        await noOverflow(page);
        await page.locator('.study-aid-close').click();
      }
      expect(state.posts.length === 3 && state.posts.every(post => post.theme === theme), `posts: ${JSON.stringify(state.posts.map(p => p.theme))}`);
      expect(state.posts.every(post => post.text && post.context), 'section text and context sent');
      await context.close();
    });
  }

  await check('Notes → Visualize → Make diagram inserts the visual', async () => {
    const { context, page, state } = await session(browser);
    await page.goto(`${BASE}/smartnotes?id=n1`);
    const paper = page.locator('.sn-paper');
    await paper.waitFor();
    await page.waitForTimeout(800);
    await paper.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Supply rises as price rises.');
    await page.click('.sn-visualize-btn');
    await page.evaluate(() => {
      const node = [...document.querySelectorAll('.sn-paper p')].find(p => p.textContent.includes('Supply'));
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    });
    await page.click('.sn-visualize-confirm');
    await page.locator('.sn-diagram-body .nv-image').waitFor({ timeout: 10000 });
    expect(state.posts.length === 1 && /Supply/.test(state.posts[0].text), 'highlight not sent');
    await page.click('.sn-diagram-body button:has-text("Use this")');
    expect((await page.locator('.sn-paper img.nv-inline').count()) === 1, 'visual not inserted into the note');
    await page.screenshot({ path: path.join(SHOTS, 'visual-notes-1440-light.png') });
    await context.close();
  });

  await check('Timeout/failure falls back to the built-in diagram with one short message', async () => {
    const { context, page } = await session(browser, { visual: 'fallback' });
    await page.goto(`${BASE}/guide/${G}`);
      await page.click('.c-pill:has-text("Cards")');
    await page.locator('.reader-actions button:has-text("Explain")').first().click();
    await page.locator('.study-aid-tab:has-text("Diagram")').click();
    await page.locator('.nv button:has-text("Make visual")').click();
    await page.locator('.nv-error').waitFor({ timeout: 10000 });
    expect((await page.locator('.nv-error').innerText()) === "Couldn't make a visual. Try again.", 'wrong error text');
    expect((await page.locator('.nv svg, .nv .mermaid-diagram, .nv [class*="mermaid"]').count()) >= 1, 'built-in diagram missing');
    await context.close();
  });

  await check('Free limit opens the upgrade popup', async () => {
    const { context, page } = await session(browser, { visual: 'limit', left: 0 });
    await page.goto(`${BASE}/guide/${G}`);
      await page.click('.c-pill:has-text("Cards")');
    await page.locator('.reader-actions button:has-text("Explain")').first().click();
    await page.locator('.study-aid-tab:has-text("Diagram")').click();
    await page.locator('.nv button:has-text("Make visual")').click();
    await page.locator('[role="dialog"]').filter({ hasText: /visual/i }).first().waitFor({ timeout: 10000 });
    await context.close();
  });

  await check('Tutor: a diagram reply can become a visual', async () => {
    const { context, page, state } = await session(browser);
    state.tutor.messages = [{ role: 'user', text: 'Show me' }, { role: 'ai', text: 'Here is how it flows.\n```mermaid\ngraph TD; A-->B\n```' }];
    await page.goto(`${BASE}/tutor`);
    await page.locator('.nv button:has-text("Make visual")').first().click({ timeout: 15000 });
    await page.locator('.nv-image').waitFor({ timeout: 10000 });
    expect(/how it flows/.test(state.posts[0].text) && !/mermaid/.test(state.posts[0].text), 'tutor text not cleaned');
    await context.close();
  });

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
