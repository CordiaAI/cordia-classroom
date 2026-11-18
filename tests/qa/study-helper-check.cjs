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
    const right = page.locator('.quiz-option:has-text("Right"), .quiz-option:has-text("power reactions")').first();
    if (await right.count() && await right.isEnabled()) { await right.click(); await page.waitForTimeout(80); continue; }
    const sure = page.locator('button:has-text("Sure")').first();
    if (await sure.count() && await sure.isVisible()) { await sure.click(); await page.waitForTimeout(80); continue; }
    const next = page.locator('button.quiz-next').first();
    if (await next.count() && await next.isVisible()) { await next.click(); await page.waitForTimeout(120); continue; }
    const typed = page.locator('.learn-card textarea, .learn-card input[type="text"]').first();
    if (await typed.count()) { await typed.fill('Concept explained in plain words'); await typed.press('Enter'); await page.waitForTimeout(400); continue; }
    await page.waitForTimeout(200);
  }
  throw new Error('the check-in round never finished');
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
      await page.waitForURL(/\/learn\//, { timeout: 15000 });
      await page.locator('text=Check-in quiz: answer what you can').waitFor({ timeout: 20000 });
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
      await page.waitForURL(/\/tutor/, { timeout: 15000 });
      await page.locator('text=Check-in done:').waitFor({ timeout: 15000 });
      expect(await page.locator('text=I need to study for my bio test').count() > 0, 'the conversation was not kept');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `tutor-next-steps-${scheme}.png`) });
    });
    await context.close();
  }
  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
