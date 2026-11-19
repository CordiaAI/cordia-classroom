// The Tutor as a study helper (feedback F6) against a local build, mocked API: a study request on the
// chat home gets a plan with buttons, "Start the check-in quiz" opens Learn with the test date and runs
// one short round, and "Back to the Tutor" shows the Tutor's next steps in the same conversation.
// Screenshots at 1440 x 900, light and dark.   BASE=http://localhost:3110 OUT=/tmp/shots node tests/qa/study-helper-check.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3110';
const OUT = process.env.OUT || path.join(__dirname, 'out');
const GUIDE = 'a0000000-0000-4000-8000-000000000002';
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n')[0].slice(0, 240)}`); }
}

const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const TEST_DATE = day(5);

function planReply(body) {
  if (!/study|test|exam/i.test(body.question)) return null;
  return {
    action: 'study_plan',
    answer: "Let's get you ready for your test in 5 days. Here's the plan:\n1. **Check-in quiz today:** a short Learn round on Cell Biology Basics to see where you stand.\n2. **A Learn round each day:** I'll tell you how many ideas from your score.\n3. **Final check** the day before.",
    study_plan: { guide: { id: GUIDE, title: 'Cell Biology Basics' }, test_date: TEST_DATE, exam: null, actions: [
      { kind: 'checkin', label: 'Start the check-in quiz', href: `/learn/${GUIDE}?test=${TEST_DATE}&checkin=1` },
      { kind: 'attach', label: 'Attach notes' },
    ] },
  };
}

async function session(browser, scheme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const state = createState(true);
  state.chatReply = planReply;
  await install(context, state);
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, theme]) => {
    localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r');
    localStorage.setItem('theme', theme);
  }, [TOKEN, USER, scheme]);
  return { context, page, state };
}

// Answers the round: the right choice, "Sure", then Next, until the round's summary shows.
async function finishRound(page) {
  for (let step = 0; step < 40; step += 1) {
    if (await page.locator('text=Check-in done').count()) return;
    const next = page.locator('button.quiz-next').first();
    if (await next.count() && await next.isVisible()) { await next.click(); await page.waitForTimeout(150); continue; }
    const sure = page.locator('.retain-sure button:has-text("Sure")').first();
    if (await sure.count() && await sure.isVisible()) { await sure.click(); await page.waitForTimeout(100); continue; }
    const right = page.locator('button.quiz-option:has-text("Right"), button.quiz-option:has-text("power reactions")').first();
    if (await right.count()) { await right.click(); await page.waitForTimeout(100); continue; }
    const typed = page.locator('.learn-card textarea, .learn-card input[type="text"]').first();
    if (await typed.count()) { await typed.fill('Concept explained in plain words'); await typed.press('Enter'); await page.waitForTimeout(400); continue; }
    await page.waitForTimeout(200);
  }
  throw new Error('the check-in round never finished');
}


// Contrast of an element's first text line against the pixels right around it (the real backdrop, glass included).
async function contrast(page, selector) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const tr = await el.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node.firstChild); const b = range.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, color: getComputedStyle(node).color };
  });
  const shot = await page.screenshot();
  return page.evaluate(async ({ b64, tr }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const lum = rgb => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
    const fg = tr.color.match(/[\d.]+/g).map(Number); const alpha = fg[3] ?? 1; const ratios = [];
    for (let x = tr.x; x < tr.x + tr.w; x += 6) for (const y of [tr.y - 1, tr.y + tr.h + 1]) {
      const bg = Array.from(ctx.getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data).slice(0, 3);
      const mixed = fg.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha));
      const [hi, lo] = [lum(mixed), lum(bg)].sort((a, b) => b - a); ratios.push((hi + 0.05) / (lo + 0.05));
    }
    ratios.sort((a, b) => a - b);
    return { min: +ratios[0].toFixed(2), median: +ratios[Math.floor(ratios.length / 2)].toFixed(2) };
  }, { b64: shot.toString('base64'), tr });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  for (const scheme of ['light', 'dark']) {
    const { context, page, state } = await session(browser, scheme);
    await check(`${scheme}: a study request on the chat home gets a plan with buttons`, async () => {
      await page.goto(BASE + '/home');
      const box = page.locator('textarea').first();
      await box.waitFor({ timeout: 20000 });
      await box.fill('I need to study for my bio test in 5 days');
      await box.press('Enter');
      await page.locator('.plan-actions').waitFor({ timeout: 15000 });
      expect(await page.locator('.plan-actions a:has-text("Start the check-in quiz")').count() === 1, 'no check-in button');
      expect(await page.locator('.plan-actions button:has-text("Attach notes")').count() === 1, 'no attach button');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `home-plan-${scheme}.png`) });
      await page.locator('.plan-actions a').first().focus();
      await page.screenshot({ path: path.join(OUT, `home-plan-focus-${scheme}.png`) });
    });
    await check(`${scheme}: the check-in opens Learn with the date and starts a round`, async () => {
      await page.locator('.plan-actions a:has-text("Start the check-in quiz")').click();
      await page.waitForURL(/\/learn\//, { timeout: 90000 }); // a dev server compiles the page first
      await page.locator('text=Check-in quiz: one short round').waitFor({ timeout: 90000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `learn-checkin-${scheme}.png`) });
    });
    await check(`${scheme}: finishing the round sends the score and offers the way back`, async () => {
      await finishRound(page);
      await page.locator('text=Your Tutor has your next steps').waitFor({ timeout: 10000 });
      expect(state.checkin?.guide_id === GUIDE && state.checkin.total > 0, 'the score never reached the Tutor');
      expect(state.checkin.test_date === TEST_DATE, `test date ${state.checkin.test_date}`);
      expect(!page.url().includes('checkin=1'), 'the check-in stays in the address');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `learn-checkin-done-${scheme}.png`) });
    });
    await check(`${scheme}: back in the Tutor, the next steps are in the same conversation`, async () => {
      await page.locator('button:has-text("Back to the Tutor")').click();
      await page.waitForURL(/\/tutor/, { timeout: 90000 });
      await page.locator('text=Check-in done:').waitFor({ timeout: 90000 });
      expect(await page.locator('text=I need to study for my bio test').count() > 0, 'the conversation was not kept');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `tutor-next-steps-${scheme}.png`) });
    });
    await context.close();
  }
  await check('a check-in the Tutor misses says so and can be sent again; phone width', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const state = createState(true);
    state.chatReply = planReply;
    state.failCheckin = true;
    await install(context, state);
    const page = await context.newPage();
    await page.goto(BASE + '/login');
    await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', 'light'); }, [TOKEN, USER]);
    await page.goto(BASE + '/home');
    const box = page.locator('textarea').first();
    await box.waitFor({ timeout: 30000 });
    await box.fill('I need to study for my bio test in 5 days');
    await box.press('Enter');
    await page.locator('.plan-actions').waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'home-plan-390.png') });
    await page.goto(BASE + `/learn/${GUIDE}?test=${TEST_DATE}&checkin=1`);
    await finishRound(page);
    await page.locator("text=The Tutor didn't get your score").waitFor({ timeout: 10000 });
    expect(page.url().includes('checkin=1'), 'a failed check-in should keep its place');
    await page.screenshot({ path: path.join(OUT, 'learn-checkin-failed-390.png'), fullPage: true });
    state.failCheckin = false;
    await page.locator('button:has-text("Send it again")').click();
    await page.locator('text=Your Tutor has your next steps').waitFor({ timeout: 10000 });
    await context.close();
  });
  await check('a plan with no guide builds the review set from Canvas and opens its check-in', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const state = createState(true);
    state.chatReply = () => ({ action: 'study_plan', answer: "Let's get you ready for Midterm in 6 days. You don't have a guide for it yet. I can gather your Canvas material for this class into a review set, then start a short check-in quiz.",
      study_plan: { guide: null, test_date: day(6), exam: { key: 'canvas-77', title: 'Midterm' }, actions: [{ kind: 'canvas_review', label: 'Build it from Canvas', item_key: 'canvas-77' }, { kind: 'attach', label: 'Attach notes instead' }] } });
    await install(context, state);
    await context.route(/localhost:8000\/plans\/canvas-77\/review-set$/, async route => { await new Promise(resolve => setTimeout(resolve, 1200)); route.fulfill({ json: { guide: { id: GUIDE, title: 'Midterm: review' }, due_at: new Date().toISOString() } }); });
    const page = await context.newPage();
    await page.goto(BASE + '/login');
    await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', 'light'); }, [TOKEN, USER]);
    await page.goto(BASE + '/home');
    const box = page.locator('textarea').first();
    await box.waitFor({ timeout: 30000 });
    await box.fill('help me prep for the midterm');
    await box.press('Enter');
    const build = page.locator('.plan-actions button:has-text("Build it from Canvas")');
    await build.waitFor({ timeout: 15000 });
    const before = await build.boundingBox();
    await build.click();
    await page.waitForTimeout(600);
    const during = await build.boundingBox();
    expect(Math.abs(before.width - during.width) < 1, 'the button changed width while working');
    expect(await build.getAttribute('aria-disabled') === 'true', 'the button is not marked as working');
    await page.screenshot({ path: path.join(OUT, 'home-canvas-building-light.png') });
    await page.waitForURL(new RegExp(`/learn/${GUIDE}\\?test=${day(6)}&checkin=1`), { timeout: 90000 });
    await context.close();
  });

  // F6b: the check-in end at both widths and in both schemes; status lines on the card at 4.5:1; 44px tap
  // targets at 390; the working mark still shows with reduced motion.
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const scheme of ['light', 'dark']) {
      for (const fail of [false, true]) {
        await check(`${scheme} @${width}: check-in end (${fail ? 'not sent' : 'sent'}) reads at 4.5:1 on the card`, async () => {
          const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
          const state = createState(true);
          state.chatReply = planReply;
          state.failCheckin = fail;
          await install(context, state);
          const page = await context.newPage();
          await page.goto(BASE + '/login');
          await page.evaluate(([token, user, theme]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', theme); }, [TOKEN, USER, scheme]);
          if (!fail) {
            await page.goto(BASE + '/home');
            const box = page.locator('textarea').first();
            await box.waitFor({ timeout: 30000 });
            await box.fill('I need to study for my bio test in 5 days');
            await box.press('Enter');
            await page.locator('.plan-actions').waitFor({ timeout: 15000 });
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(OUT, `plan-${scheme}-${width}.png`) });
            if (width === 390) {
              for (const target of await page.locator('.plan-actions .plan-btn').all()) {
                const box = await target.boundingBox();
                expect(box.height >= 44, `plan button is ${box.height}px tall at 390`);
              }
            }
          }
          await page.goto(BASE + `/learn/${GUIDE}?test=${TEST_DATE}&checkin=1`);
          await page.locator('text=Check-in quiz: one short round').waitFor({ timeout: 90000 });
          await finishRound(page);
          await page.locator(fail ? "text=The Tutor didn't get your score" : 'text=Your Tutor has your next steps').waitFor({ timeout: 10000 });
          await page.waitForTimeout(500);
          expect(await page.locator('.learn-panel .learn-checkin-status').count() === 1, 'the status line is not on the card');
          const ratio = await contrast(page, '.learn-checkin-status');
          console.log(`     contrast ${JSON.stringify(ratio)}`);
          expect(ratio.min >= 4.5, `status line contrast ${ratio.min}`);
          if (fail && width === 390) {
            const again = await page.locator('button:has-text("Send it again")').boundingBox();
            expect(again.height >= 44, `"Send it again" is ${again.height}px tall at 390`);
          }
          await page.screenshot({ path: path.join(OUT, `checkin-end-${fail ? 'failed' : 'sent'}-${scheme}-${width}.png`), fullPage: width === 390 });
          await context.close();
        });
      }
    }
  }
  await check('reduced motion: a working plan button still shows its mark', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
    const state = createState(true);
    state.chatReply = () => ({ action: 'study_plan', answer: "Let's get you ready for Midterm in 6 days.",
      study_plan: { guide: null, test_date: day(6), exam: { key: 'canvas-77', title: 'Midterm' }, actions: [{ kind: 'canvas_review', label: 'Build it from Canvas', item_key: 'canvas-77' }] } });
    await install(context, state);
    await context.route(/localhost:8000\/plans\/canvas-77\/review-set$/, async route => { await new Promise(resolve => setTimeout(resolve, 2000)); route.fulfill({ status: 502, json: { detail: 'Canvas is not answering.' } }); });
    const page = await context.newPage();
    await page.goto(BASE + '/login');
    await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', 'light'); }, [TOKEN, USER]);
    await page.goto(BASE + '/home');
    const box = page.locator('textarea').first();
    await box.waitFor({ timeout: 30000 });
    await box.fill('help me prep for the midterm');
    await box.press('Enter');
    const build = page.locator('.plan-actions button:has-text("Build it from Canvas")');
    await build.waitFor({ timeout: 15000 });
    // When the mark appears, measured in the page from the press.
    await build.evaluate(node => {
      window.__markAt = null;
      node.addEventListener('click', () => { window.__pressAt = performance.now(); }, { capture: true, once: true });
      new MutationObserver(() => { if (node.classList.contains('is-marked') && window.__markAt === null) window.__markAt = performance.now(); })
        .observe(node, { attributes: true, attributeFilter: ['class'] });
    });
    await build.click();
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => Math.round(window.__markAt - window.__pressAt));
    console.log(`     mark shown ${after}ms after the press`);
    expect(after >= 290 && after < 600, `the mark showed ${after}ms after the press`);
    const seen = await build.evaluate(node => ({ face: getComputedStyle(node.querySelector('.plan-face')).visibility, mark: getComputedStyle(node.querySelector('.plan-spinner')).opacity }));
    expect(seen.face === 'hidden' && seen.mark === '1', `with reduced motion the mark is ${JSON.stringify(seen)}`);
    await page.screenshot({ path: path.join(OUT, 'plan-working-reduced-motion.png') });
    await page.locator('text=Canvas is not answering.').waitFor({ timeout: 10000 });
    await context.close();
  });
  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
