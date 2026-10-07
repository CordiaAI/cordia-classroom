// Run against a built frontend with CORDIA_SMOKE_BASE_URL set.
// Provider responses and identity are fixtures; this proves frontend behavior only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.CORDIA_SMOKE_BASE_URL;
const guide = {
  id: 'design-guide', folder_id: 'design-class', title: 'Relations and Functions',
  created_at: '2026-10-01T12:00:00Z', read_progress: .48, is_bookmarked: false,
  study_guide: 'Q1: What is a relation between two sets?\nA1: A relation from A to B is a subset of the Cartesian product A × B.\nQ2: What defines a function?\nA2: A function associates each element of its domain with exactly one element of its codomain.',
  notes: '- A relation connects elements of two sets.\n- A function assigns exactly one output to each input.',
  flashcards: [{ front: 'What defines a function?', back: 'Exactly one output for each input.' }],
};
const fixtures = {
  '/auth/me': { user_id: 'design-student', name: 'Jamie Lee', email: 'student@example.test' },
  '/feedback/reviewer-status': { reviewer: false },
  '/folders': { folders: [{ id: 'design-class', name: 'Discrete Mathematics' }] },
  '/guides': { guides: [guide] },
  '/guides/design-guide': { guide },
  '/smart_notes': { notes: [] },
  '/learning-style': { enabled: false, style: null, prompted: true },
  '/learning-preference': {},
  '/onboarding': { completed: true, step: 'done' },
  '/stats/overview': { total_guides: 1, total_flashcards: 1, avg_quiz_score: 80, minutes_today: 24 },
  '/stats/streak': { current_streak: 6, studied_today: true, week: [] },
  '/stats/insights': { strengths: [], needs_work: [], tips: [], total_answered: 0 },
  '/calendar/connection': { connected: false },
  '/calendar': { items: [] },
  '/quiz/design-guide/history': { attempts: [] },
  '/billing/status': { plan: 'free', usage: {} },
  '/tutor/session': { id: 'design-session', status: 'idle', active_skill: 'explain', browser_available: false, messages: [], skills: [{ id: 'explain', label: 'Explain', available: true, requires_context: true }] },
};

test('Classroom glass workspace renders responsively and preserves study interactions', { skip: !base, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CORDIA_BROWSER_PATH || undefined, headless: true });
  const output = process.env.CORDIA_SMOKE_OUTPUT || '/tmp/classroom-design-smoke';
  await fs.mkdir(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(`${new URL(page.url()).pathname}: ${error.message}`));
    await page.route('http://localhost:8000/**', route => {
      const resource = new URL(route.request().url()).pathname;
      return route.fulfill({ json: fixtures[resource] || { ok: true }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    async function visit(route) {
      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.fonts.ready);
    }
    async function noOverflow(label) {
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 3000 }).catch(() => {});
      const sizes = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      if (sizes.content > sizes.viewport + 1) {
        console.log(await page.evaluate(() => ['.top-navigation','.main-content','.dashboard-workspace-grid','.dashboard-left-stack','.dashboard-study-rail'].map(selector => {const e=document.querySelector(selector);if (!e) return {selector};const c=getComputedStyle(e);return {selector,display:c.display,width:c.width,columns:c.gridTemplateColumns,position:c.position,height:c.height,minWidth:c.minWidth,margin:c.margin,padding:c.padding,transform:c.transform};})));
        console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => { const r = element.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).slice(0, 12).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width }))));
        await page.screenshot({ path: path.join(output, 'overflow.png'), fullPage: true });
      }
      assert.ok(sizes.content <= sizes.viewport + 1, `${label}: ${sizes.content}px content exceeds ${sizes.viewport}px viewport`);
    }
    await visit('/');
    assert.equal(await page.locator('.login-panel-right').count(), 1);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Manrope')), true);
    await noOverflow('desktop login');
    assert.ok(await page.evaluate(() => document.querySelector('.login-brand-name').getBoundingClientRect().right < document.querySelector('.landing-document-preview').getBoundingClientRect().left), 'brand and document window must remain separate');
    await page.screenshot({ path: path.join(output, 'login-desktop.png') });
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(`login ${width}`);
      await page.getByRole('tab', { name: 'Create account' }).click();
      assert.equal(await page.getByRole('textbox', { name: 'Full name' }).count(), 1);
      await noOverflow(`signup ${width}`);
      if (width === 390) await page.screenshot({ path: path.join(output, 'signup-mobile.png'), fullPage: true });
      await page.getByRole('tab', { name: 'Sign in', exact: true }).click();
    }
    await page.addInitScript(() => {
      const payload = btoa(JSON.stringify({ sub: 'design-student', exp: 4102444800, email: 'student@example.test' }));
      localStorage.setItem('authToken', `fixture.${payload}.fixture`);
      localStorage.setItem('userName', 'Jamie Lee');
      localStorage.setItem('userEmail', 'student@example.test');
      localStorage.setItem('theme', 'light');
      localStorage.setItem('cordiaTutorOpen', 'false');
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await visit('/dashboard');
    await page.locator('.study-scene-intro h1').waitFor();
    await page.locator('.document-section').first().waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.study-scene-tutor')).opacity === '1');
    await noOverflow('desktop dashboard');
    await page.screenshot({ path: path.join(output, 'dashboard-light.png'), fullPage: true });
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(`study home ${width}`);
      if (width === 390) await page.screenshot({ path: path.join(output, 'home-mobile.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await visit('/guide/design-guide');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.waitForFunction(() => document.querySelector('.workspace-rail').getBoundingClientRect().width < 70);
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await page.waitForFunction(() => document.querySelector('.workspace-rail').getBoundingClientRect().width > 180);
    await page.locator('.guide-reader-window').waitFor();
    await page.locator('.tab-btn').filter({ hasText: /^Notes$/ }).click();
    assert.match(await page.locator('.notes-list').innerText(), /A relation connects/);
    await page.locator('.tab-btn').filter({ hasText: /^Study Guide$/ }).click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    assert.equal(await page.locator('.document-paper').evaluate(element => element.style.getPropertyValue('--document-scale')), '1.1');
    await page.getByRole('button', { name: 'Mark as read' }).first().click();
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Tutor', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tutor-drawer')?.getAttribute('aria-hidden') === 'false');
    await page.waitForFunction(() => document.querySelector('.guide-reader-window').getBoundingClientRect().right + 16 <= document.querySelector('.tutor-drawer').getBoundingClientRect().left);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: path.join(output, 'study-tutor-light.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close Cordia Tutor', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tutor-drawer')?.getAttribute('aria-hidden') === 'true');
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('theme')), 'dark');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('tutor-open') && getComputedStyle(document.querySelector('.main-content')).paddingRight === '30px');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: path.join(output, 'study-dark.png'), fullPage: true });
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(`guide ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open Cordia Tutor', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tutor-drawer')?.getAttribute('aria-hidden') === 'false');
    await noOverflow('mobile Tutor');
    await page.screenshot({ path: path.join(output, 'study-tutor-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close Cordia Tutor', exact: true }).first().click();
    await visit('/flashcards/study?guideId=design-guide');
    const card = page.getByRole('button', { name: 'Reveal answer', exact: true });
    await card.waitFor();
    await card.focus();
    await page.keyboard.press('Space');
    assert.equal(await page.getByRole('button', { name: 'Show question' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.flashcard-back').getAttribute('aria-hidden'), 'false');
    await page.getByRole('button', { name: 'Got It', exact: true }).click();
    await page.getByText('Session Complete!', { exact: true }).waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.workspace-route')).animationName), 'none');
    await visit('/create');
    await page.getByText('Upload Files', { exact: true }).waitFor();
    await noOverflow('mobile creation');
    await page.screenshot({ path: path.join(output, 'create-mobile.png'), fullPage: true });
    for (const route of ['/dashboard?view=guides', '/smartnotes', '/practice', '/settings', '/flashcards']) {
      await visit(route);
      await page.locator('.main-content').waitFor();
      await noOverflow(`mobile ${route}`);
      await page.screenshot({ path: path.join(output, `${route.slice(1).replace('?', '-')}-mobile.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await visit('/dashboard?view=guides');
    await page.getByRole('heading', { name: 'My classes', exact: true }).waitFor();
    await noOverflow('desktop class library');
    await page.screenshot({ path: path.join(output, 'classes-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Add class' }).click();
    await page.getByRole('textbox', { name: 'Class name' }).fill('Biology');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await visit('/settings');
    await page.getByRole('heading', { name: 'My profile', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'profile-desktop.png'), fullPage: true });
    await visit('/dashboard');
    await page.locator('.document-section').first().waitFor();
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.study-scene-tutor')).opacity === '1');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: path.join(output, 'home-dark.png'), fullPage: true });
    assert.deepEqual(errors, [], 'frontend must not throw browser exceptions');
  } finally {
    await browser.close();
  }
});
