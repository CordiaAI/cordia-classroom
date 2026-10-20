// Contrast QA: every text element and icon is checked against the real pixels behind it
// (a screenshot with all text made transparent), on every route and with each popup open,
// in light and dark. Fails under 4.5:1 (3:1 for large text and disabled controls).
// Uses the mocked API only (never production). Run against a local build:
//   BASE=http://localhost:3100 node tests/qa/contrast-qa.cjs [--widths=390,1440] [--themes=dark] [--routes=/dashboard] [--popups=help]
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = path.resolve(process.env.OUT || 'qa-screenshots/contrast');
const arg = name => { const item = process.argv.find(value => value.startsWith(`--${name}=`)); return item ? item.slice(name.length + 3) : ''; };
const G = 'a0000000-0000-4000-8000-000000000001';
const ROUTES = [
  '/', '/login', '/signup', '/pricing', '/mission', '/privacy', '/terms', '/honor-code',
  '/dashboard', '/library', '/calendar', '/smartnotes', '/smartnotes?id=n1', '/tutor',
  '/settings', '/settings?section=learning', '/settings?section=appearance', '/settings?section=plan',
  `/guide/${G}`, `/folder/f0000000-0000-4000-8000-000000000001`, `/practice/${G}`, `/quiz/${G}`, '/flashcards',
  '/nclex/a0000000-0000-4000-8000-000000000003', '/install-extension', '/session',
];
const PUBLIC = new Set(['/', '/login', '/signup', '/privacy', '/terms', '/honor-code']);
const POPUPS = [
  { name: 'avatar-menu', route: '/dashboard', scope: '.acct-bubbles', open: async page => { await page.locator('.c-topbar .c-avatar').click(); await page.waitForTimeout(500); } },
  { name: 'new-sheet', route: '/dashboard', scope: '.c-sheet', open: page => page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:new', { detail: { mode: '' } }))) },
  { name: 'help', route: '/dashboard', scope: '.c-sheet', open: async page => { await page.locator('.c-topbar .c-avatar').click(); await page.getByRole('menuitem', { name: 'Help' }).click(); } },
  { name: 'search', route: '/dashboard', scope: '.c-sheet', open: page => page.keyboard.press('Control+k') },
  { name: 'upgrade', route: '/dashboard', scope: '.upgrade-dialog', open: page => page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:upgrade', { detail: {} }))) },
  { name: 'limit-practice', route: `/practice/${G}`, scope: '.upgrade-dialog', open: page => page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:limit', { detail: { feature: 'practice', plan: 'free', limit: 1, used: 1, message: "You've used all 1 practice sets this month." } }))) },
  { name: 'tutor-drawer', route: '/library', scope: '.tutor-drawer', open: page => page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:tutor-toggle'))) },
  { name: 'tutor-material', route: '/tutor', scope: '.tutor-select-options', open: page => page.locator('.tutor-select-trigger').first().click() },
  { name: 'tutor-options', route: '/tutor', scope: '.cordia-tutor', open: page => page.locator('.tutor-context-controls > summary').first().click() },
  { name: 'guide-menu', route: `/guide/${G}`, scope: '.c-menu', open: page => page.getByRole('button', { name: 'Guide actions' }).click() },
  { name: 'notes-dropdown', route: '/smartnotes?id=n1', scope: '.sn-notes-dropdown', open: page => page.locator('.sn-notes-dropdown-trigger').click() },
];

async function audit(page, scope) {
  const elements = await page.evaluate(scope => {
    const out = [];
    const root = scope ? [...document.querySelectorAll(scope)].pop() : null;
    const visible = el => {
      if (scope && !(root && root.contains(el))) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05 && rect.width > 2 && rect.height > 2
        && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && !el.closest('[aria-hidden="true"], .sr-only');
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!walker.currentNode.textContent.trim() || !el || seen.has(el) || el.closest('script, style, noscript, option') || !visible(el)) continue;
      seen.add(el);
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      const rect = range.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || rect.left < 0 || rect.right > innerWidth) continue;
      // Text hidden under fixed chrome (top bar, tab bar, an open sheet) is not on screen.
      const cx = Math.min(innerWidth - 1, Math.max(0, rect.x + rect.width / 2));
      const cy = Math.min(innerHeight - 1, Math.max(0, rect.y + rect.height / 2));
      const top = document.elementFromPoint(cx, cy);
      if (top && !el.contains(top) && !top.contains(el)) continue;
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      let opacity = 1;
      for (let node = el; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      out.push({
        kind: 'text',
        disabled: Boolean(el.closest('button:disabled, [aria-disabled="true"], input:disabled')),
        label: walker.currentNode.textContent.trim().slice(0, 30),
        tag: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).filter(c => !c.startsWith('jsx-'))[0] : ''),
        color: style.color, opacity, large: size >= 24 || (size >= 18.66 && bold),
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      });
    }
    return { out, dark: document.documentElement.getAttribute('data-theme') === 'dark' };
  }, scope);

  const hide = await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } ::placeholder { color: transparent !important; }' });
  await page.waitForTimeout(80);
  const shot = await page.screenshot({ type: 'png' });
  await hide.evaluate(node => node.remove());

  return page.evaluate(async ({ png, items }) => {
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
      const data = ctx.getImageData(x, y, w, h).data;
      const rs = []; const gs = []; const bs = [];
      const step = Math.max(4, Math.floor((data.length / 4) / 400)) * 4;
      for (let i = 0; i < data.length; i += step) { rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); }
      const med = list => list.sort((m, n) => m - n)[Math.floor(list.length / 2)];
      const bg = [med(rs), med(gs), med(bs)];
      const parts = item.color.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 1];
      const alpha = (parts.length > 3 ? parts[3] : 1) * item.opacity;
      const fg = [0, 1, 2].map(i => parts[i] * alpha + bg[i] * (1 - alpha));
      const value = ratio(fg, bg);
      const need = item.large || item.disabled ? 3 : 4.5;
      if (value < need - 0.05) out.push(`${value.toFixed(2)}:1 (needs ${need}) ${item.tag} "${item.label}"`);
    }
    return out;
  }, { png: shot.toString('base64'), items: elements.out });
}

async function open(browser, { width, theme, isPublic }) {
  const context = await browser.newContext({ viewport: { width, height: width < 640 ? 844 : 900 }, colorScheme: theme, reducedMotion: 'reduce' });
  await install(context, createState(true));
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, theme, isPublic]) => {
    if (!isPublic) { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); }
    localStorage.setItem('theme', theme);
  }, [TOKEN, USER, theme, isPublic]);
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
  const log = (name, problems) => {
    report.push({ name, problems });
    if (problems.length) failed += 1;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.length ? '\n   - ' + problems.slice(0, 12).join('\n   - ') : ''}`);
  };
  for (const theme of themes) for (const width of widths) {
    for (const route of routes) {
      const { context, page } = await open(browser, { width, theme, isPublic: PUBLIC.has(route.split('?')[0]) });
      await page.goto(BASE + route).catch(() => {});
      await page.waitForTimeout(1400);
      const problems = await audit(page, null);
      // Scroll once so text below the first screen is checked too.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      if (height > (width < 640 ? 844 : 900) * 1.2) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(300);
        problems.push(...await audit(page, null));
      }
      log(`${theme} ${width} ${route}`, [...new Set(problems)]);
      await context.close();
    }
    for (const popup of popups) {
      const { context, page } = await open(browser, { width, theme, isPublic: false });
      await page.goto(BASE + popup.route).catch(() => {});
      await page.waitForTimeout(1400);
      const problems = [];
      try {
        await popup.open(page);
        await page.waitForTimeout(600);
        if (!(await page.locator(popup.scope).count())) throw new Error('did not appear');
        problems.push(...await audit(page, popup.scope));
        await page.screenshot({ path: path.join(OUT, `${theme}-${width}-popup-${popup.name}.png`) });
      } catch (error) {
        problems.push(`could not open: ${error.message.split('\n')[0].slice(0, 100)}`);
      }
      log(`${theme} ${width} popup:${popup.name}`, problems);
      await context.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, `contrast-${widths.join('_')}-${themes.join('_')}.json`), JSON.stringify(report, null, 2));
  console.log(`\n${report.length - failed} of ${report.length} clean.`);
  process.exit(failed ? 1 : 0);
})();
