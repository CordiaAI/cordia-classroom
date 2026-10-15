// UI QA for every route: 390 / 1024 / 1440 px, light and dark, plus popups.
// Fails on: contrast (4.5:1 body, 3:1 large text and icons, measured against the real rendered
// pixels), near-white backgrounds in dark mode, horizontal scroll, overlapping controls, controls
// closer than 8px, text under 13px, mobile tap targets under 40px, empty cards, unlabeled
// buttons, popovers that ignore Escape, and containers wider than 1080px (Notes and Calendar
// excepted). Saves screenshots to qa-screenshots/.
//
// Run against a local build with the mocked API (never production):
//   (cd web && npx next build && npx next start -p 3100) &
//   node tests/qa/ui-qa.cjs [--routes=/dashboard,/library] [--widths=390] [--themes=dark]
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = path.join(__dirname, '../../qa-screenshots');
const G = 'a0000000-0000-4000-8000-000000000001';
const arg = name => (process.argv.find(item => item.startsWith(`--${name}=`)) || '').split('=')[1];

const ROUTES = [
  '/dashboard', '/library', '/library?tab=cards', `/guide/${G}`, `/guide/${G}?tab=summary`, `/guide/${G}?tab=quiz`, `/guide/${G}?tab=cards`,
  `/guide/${G}?tab=practice`, '/practice', '/smartnotes', '/smartnotes?id=n1', '/calendar', '/tutor', '/grove',
  '/settings', '/settings?section=learning', '/settings?section=appearance', '/settings?section=plan', '/install-extension',
  `/folder/f0000000-0000-4000-8000-000000000001`, '/nclex/a0000000-0000-4000-8000-000000000003', '/pricing',
  '/', '/login', '/signup', '/mission', '/privacy', '/terms', '/honor-code',
];
const PUBLIC = new Set(['/', '/login', '/signup']);
const FULL_WIDTH = ['/smartnotes', '/calendar'];

// Popups opened on top of a route, each checked like a page (plus Escape).
const POPUPS = [
  { name: 'avatar-menu', scope: '.c-popover', route: '/dashboard', open: page => page.getByRole('button', { name: /account menu/i }).first().click() },
  { name: 'new-sheet', scope: '.c-sheet', route: '/dashboard', open: page => page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:new'))) },
  { name: 'help', scope: '.c-sheet', route: '/dashboard', open: async page => { await page.getByRole('button', { name: /account menu/i }).first().click(); await page.getByRole('menuitem', { name: 'Help' }).click(); } },
  { name: 'search', scope: '.c-sheet', route: '/library', open: page => page.keyboard.press('Control+k') },
  { name: 'upgrade', scope: '.c-sheet', route: '/library', open: page => page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:upgrade', { detail: { feature: 'practice' } }))) },
  { name: 'tutor-panel', scope: '.tutor-drawer', route: `/guide/${G}`, open: page => page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:tutor-toggle'))) },
  { name: 'tutor-material', scope: '.c-popover', route: '/tutor', open: page => page.getByRole('button', { name: /Study material/ }).first().click() },
  { name: 'guide-menu', scope: '.c-popover', route: `/guide/${G}`, open: page => page.getByRole('button', { name: 'Guide actions' }).click() },
  { name: 'notes-dropdown', scope: '.c-popover', route: '/smartnotes?id=n1', open: page => page.getByRole('button', { name: /All notes/ }).first().click() },
  { name: 'calendar-day', scope: '.c-sheet', route: '/calendar', open: page => page.locator('[data-qa="calendar-more"]').first().click() },
  { name: 'limit-error', scope: '.c-scrim', route: '/tutor', open: page => page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:limit', { detail: { feature: 'tutor', message: 'Limit reached' } }))) },
];

async function audit(page, { width, theme, allowWide, scope = null }) {
  // 1. Layout and semantics, measured in the page.
  const layout = await page.evaluate(({ width, allowWide, scope }) => {
    const problems = [];
    const root = scope ? [...document.querySelectorAll(scope)].pop() : null;
    const inScope = el => !scope || (root && root.contains(el));
    const visible = el => {
      if (!inScope(el)) return false;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      // Visually hidden helpers (skip links, sr-only) are 1px and not "on screen".
      return rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.top < innerHeight && !el.closest('[aria-hidden="true"], .sr-only');
    };
    const name = el => `<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}> "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28)}"`;
    if (!scope && document.documentElement.scrollWidth - innerWidth > 1) problems.push(`horizontal scroll ${document.documentElement.scrollWidth - innerWidth}px`);

    const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], summary')].filter(visible);
    for (const el of controls) {
      if (el.matches('button, [role=button], a[href]') && !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent.trim() || el.getAttribute('title'))) problems.push(`unlabeled control ${name(el)}`);
      const rect = el.getBoundingClientRect();
      if (width < 640 && !el.matches('input[type=checkbox], input[type=radio], a.inline, p a, li a') && (rect.height < 40 || rect.width < 40) && !el.closest('p, .c-meta')) problems.push(`tap target ${Math.round(rect.width)}x${Math.round(rect.height)} ${name(el)}`);
    }
    const pinned = el => { for (let node = el; node && node !== document.body; node = node.parentElement) if (getComputedStyle(node).position === 'fixed') return node; return null; };
    // Spacing and overlap between separate controls (not nested).
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i]; const b = controls[j];
        if (a.contains(b) || b.contains(a) || a.closest('[role=menu], [role=listbox]') || b.closest('[role=menu], [role=listbox]')) continue;
        // Page content scrolls under fixed chrome (top bar, tab bar, New button); that is not a layout overlap.
        if (pinned(a) !== pinned(b)) continue;
        if (a.closest('.c-seg, .c-pills, .c-tabbar, .c-nav, .c-chips, nav') && a.parentElement === b.parentElement) {
          // Segmented and pill groups may sit closer but must not overlap.
        }
        const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
        const dx = Math.max(rb.left - ra.right, ra.left - rb.right);
        const dy = Math.max(rb.top - ra.bottom, ra.top - rb.bottom);
        const overlap = dx < -1 && dy < -1;
        // A control placed inside a field (eye toggle, clear button) is intended.
        const contains = (outer, inner) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
        if (overlap && (contains(ra, rb) || contains(rb, ra))) continue;
        if (overlap) { problems.push(`overlap ${name(a)} / ${name(b)}`); continue; }
        const gap = Math.max(dx, dy);
        const sameGroup = a.parentElement === b.parentElement && a.parentElement.matches('.c-seg, [role=tablist], .c-tabbar, .c-nav');
        if (!sameGroup && gap >= 0 && gap < 8 && (dx < 0 || dy < 0)) problems.push(`controls ${Math.round(gap)}px apart ${name(a)} / ${name(b)}`);
      }
    }
    // Text size.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!walker.currentNode.textContent.trim() || !el || !visible(el) || el.closest('script, style, svg, noscript')) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12.95) problems.push(`text ${size}px ${name(el)}`);
    }
    // Empty cards.
    for (const card of [...document.querySelectorAll('.c-card')].filter(visible)) {
      if (!card.textContent.trim() && !card.querySelector('img, svg, canvas, input, textarea, iframe, video')) problems.push(`empty card ${name(card)}`);
    }
    // Container width.
    if (!allowWide && !scope) {
      const route = document.querySelector('.workspace-route, .public-main, main');
      const target = route?.firstElementChild || route;
      if (target && target.getBoundingClientRect().width > 1081) problems.push(`container ${Math.round(target.getBoundingClientRect().width)}px wide`);
    }
    return [...new Set(problems)];
  }, { width, allowWide, scope });

  // 2. Contrast against real pixels: one screenshot with all text transparent gives the background.
  const elements = await page.evaluate(scope => {
    const out = [];
    const root = scope ? [...document.querySelectorAll(scope)].pop() : null;
    const visible = el => {
      if (scope && !(root && root.contains(el))) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05 && rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && !el.closest('[aria-hidden="true"], .sr-only');
    };
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!walker.currentNode.textContent.trim() || !el || seen.has(el) || el.closest('script, style, noscript, svg, option') || !visible(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      const rect = range.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      // Text scrolled under fixed chrome is hidden, not low-contrast.
      const cx = Math.min(innerWidth - 1, Math.max(0, rect.x + rect.width / 2)); const cy = Math.min(innerHeight - 1, Math.max(0, rect.y + rect.height / 2));
      const top = document.elementFromPoint(cx, cy);
      if (top && !el.contains(top) && !top.contains(el)) continue;
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const disabled = Boolean(el.closest('button:disabled, [aria-disabled="true"], input:disabled'));
      out.push({ kind: 'text', disabled, label: walker.currentNode.textContent.trim().slice(0, 30), tag: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''), color: style.color, opacity: Number(style.opacity), large: size >= 24 || (size >= 18.66 && bold), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } });
    }
    for (const svg of document.querySelectorAll('svg.lucide')) {
      if (!visible(svg) || svg.closest('[disabled]')) continue;
      const rect = svg.getBoundingClientRect();
      out.push({ kind: 'icon', label: svg.closest('[aria-label]')?.getAttribute('aria-label')?.slice(0, 30) || 'icon', tag: 'svg', color: getComputedStyle(svg).color, opacity: 1, large: true, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } });
    }
    // Near-white backgrounds (checked in dark mode only by the caller).
    const whites = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const bg = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (!bg) continue;
      const [r, g, b, a = 1] = bg;
      if (a > 0.5 && r > 225 && g > 225 && b > 225) {
        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height > 400) whites.push(`${el.tagName.toLowerCase()}.${typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''} "${(el.textContent || '').trim().slice(0, 24)}"`);
      }
    }
    return { out, whites: [...new Set(whites)].slice(0, 10), dark: document.documentElement.getAttribute('data-theme') === 'dark' };
  }, scope);

  const style = await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } svg.lucide { visibility: hidden !important; } ::placeholder { color: transparent !important; }' });
  await page.waitForTimeout(60);
  const shot = await page.screenshot({ type: 'png' });
  await style.evaluate(node => node.remove());

  const failures = await page.evaluate(async ({ png, items }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + png;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const scale = img.width / innerWidth;
    const lum = ([r, g, b]) => {
      const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const out = [];
    for (const item of items) {
      const x = Math.max(0, Math.floor(item.rect.x * scale)); const y = Math.max(0, Math.floor(item.rect.y * scale));
      const w = Math.max(1, Math.min(canvas.width - x, Math.floor(item.rect.w * scale))); const h = Math.max(1, Math.min(canvas.height - y, Math.floor(item.rect.h * scale)));
      if (w < 1 || h < 1) continue;
      const data = ctx.getImageData(x, y, w, h).data;
      // Median background per channel.
      const rs = [], gs = [], bs = [];
      const step = Math.max(4, Math.floor((data.length / 4) / 400)) * 4;
      for (let i = 0; i < data.length; i += step) { rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); }
      const med = list => list.sort((m, n) => m - n)[Math.floor(list.length / 2)];
      const bg = [med(rs), med(gs), med(bs)];
      const parts = item.color.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 1];
      const alpha = (parts.length > 3 ? parts[3] : 1) * item.opacity;
      const fg = [0, 1, 2].map(i => parts[i] * alpha + bg[i] * (1 - alpha));
      const value = ratio(fg, bg);
      const need = item.large || item.disabled ? 3 : 4.5;
      if (value < need - 0.05) out.push(`${item.kind} ${value.toFixed(2)}:1 (needs ${need}) ${item.tag} "${item.label}"`);
    }
    return out;
  }, { png: shot.toString('base64'), items: elements.out });

  const problems = [...layout, ...failures];
  if (elements.dark) problems.push(...elements.whites.map(item => `near-white background in dark ${item}`));
  return problems;
}

async function signedIn(browser, { width, theme, isPublic }) {
  const context = await browser.newContext({ viewport: { width, height: width < 640 ? 844 : 900 }, colorScheme: theme });
  const state = createState(true);
  state.meta = { cordia: { v: 1, at: Date.now(), theme, wt: null, day1Status: 'done', done: ['day1'], used: ['add'], tips: [], grove: { a0000000: 42, a0000001: 3 }, rings: {}, freeze: [], first: Date.now() - 86400000 * 9 } };
  await install(context, state);
  const page = await context.newPage();
  await page.goto(BASE + '/pricing');
  await page.evaluate(([token, user, theme]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', theme); }, [TOKEN, USER, theme]);
  if (isPublic) await page.evaluate(() => localStorage.removeItem('authToken'));
  return { context, page };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const widths = (arg('widths') || '390,1024,1440').split(',').map(Number);
  const themes = (arg('themes') || 'light,dark').split(',');
  const routes = arg('routes') ? arg('routes').split(',') : ROUTES;
  const popups = arg('popups') === 'none' ? [] : POPUPS.filter(item => !arg('popups') || arg('popups').split(',').includes(item.name));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new'] });
  const report = [];
  let failed = 0;
  for (const theme of themes) {
    for (const width of widths) {
      for (const route of routes) {
        const pathname = route.split('?')[0];
        const isPublic = PUBLIC.has(pathname);
        const { context, page } = await signedIn(browser, { width, theme, isPublic });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(BASE + route);
        await page.waitForTimeout(1400);
        const problems = await audit(page, { width, theme, allowWide: FULL_WIDTH.includes(pathname) });
        if (errors.length) problems.push(`page error: ${errors[0].slice(0, 120)}`);
        const file = `${theme}-${width}${route.replace(/[^\w]+/g, '_')}.png`;
        await page.screenshot({ path: path.join(OUT, file), fullPage: true });
        report.push({ theme, width, route, problems });
        if (problems.length) failed += 1;
        console.log(`${problems.length ? 'FAIL' : 'ok  '} ${theme} ${width} ${route}${problems.length ? '\n   - ' + problems.slice(0, 12).join('\n   - ') + (problems.length > 12 ? `\n   … ${problems.length - 12} more` : '') : ''}`);
        await context.close();
      }
      for (const popup of popups) {
        const { context, page } = await signedIn(browser, { width, theme, isPublic: false });
        await page.goto(BASE + popup.route);
        await page.waitForTimeout(1400);
        const problems = [];
        try {
          await popup.open(page);
          await page.waitForTimeout(500);
          problems.push(...await audit(page, { width, theme, allowWide: true, scope: popup.scope || null }));
          await page.screenshot({ path: path.join(OUT, `${theme}-${width}-popup-${popup.name}.png`) });
          const before = await page.locator('.c-scrim').count();
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          const after = await page.locator('.c-scrim').count();
          if (before && after >= before) problems.push('Escape did not close it');
          if (!before && popup.name !== 'tutor-panel' && popup.name !== 'limit-error') problems.push('no scrim');
        } catch (error) {
          problems.push(`could not open: ${error.message.split('\n')[0].slice(0, 100)}`);
        }
        report.push({ theme, width, route: 'popup:' + popup.name, problems });
        if (problems.length) failed += 1;
        console.log(`${problems.length ? 'FAIL' : 'ok  '} ${theme} ${width} popup:${popup.name}${problems.length ? '\n   - ' + problems.slice(0, 12).join('\n   - ') : ''}`);
        await context.close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, `report-${widths.join('_')}-${themes.join('_')}.json`), JSON.stringify(report, null, 2));
  console.log(`\n${report.length - failed} of ${report.length} clean. Screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
