// Layout capture: full-page screenshots plus the position of every structural element, per route,
// width and theme. Run once on the restored layout (baseline) and once after changes, then compare
// with layout-compare.cjs. Uses the mocked API only (never production).
//   BASE=http://localhost:3100 node tests/qa/layout-capture.cjs <out-dir> [--routes=/dashboard] [--widths=390] [--themes=dark]
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const out = path.resolve(process.argv[2] || 'qa-screenshots/layout');
const arg = name => { const item = process.argv.find(value => value.startsWith(`--${name}=`)); return item ? item.slice(name.length + 3) : ''; };
const G = 'a0000000-0000-4000-8000-000000000001';
const ROUTES = (arg('routes') || [
  '/', '/login', '/signup', '/pricing', '/mission', '/dashboard', '/library', '/calendar', '/smartnotes', '/smartnotes?id=n1',
  '/tutor', '/settings', '/settings?section=learning', '/settings?section=appearance', '/settings?section=plan', '/billing',
  `/guide/${G}`, `/folder/f0000000-0000-4000-8000-000000000001`, `/practice/${G}`, `/quiz/${G}`, '/flashcards',
  `/nclex/a0000000-0000-4000-8000-000000000003`, '/install-extension', '/session',
].join(',')).split(',');
const WIDTHS = (arg('widths') || '390,1024,1440').split(',').map(Number);
const THEMES = (arg('themes') || 'light,dark').split(',');

const slug = route => route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_') || 'home';

async function capture(page) {
  return page.evaluate(() => {
    const items = [];
    const pick = 'header, nav, main, section, article, aside, footer, h1, h2, h3, .c-card, .c-pill, .c-tab, button, a[href], input, textarea, select, img, [role=tab], [role=tablist]';
    for (const el of document.querySelectorAll(pick)) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(c => c && !c.startsWith('jsx-')).slice(0, 2).join('.') : '';
      items.push({ key: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`, text: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), x: Math.round(rect.x + scrollX), y: Math.round(rect.y + scrollY), w: Math.round(rect.width), h: Math.round(rect.height) });
    }
    return { items, height: document.documentElement.scrollHeight };
  });
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new'] });
  const result = {};
  for (const theme of THEMES) for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: width < 640 ? 844 : 900 }, colorScheme: theme, reducedMotion: 'reduce' });
    await install(context, createState(true));
    const page = await context.newPage();
    await page.goto(BASE + '/login');
    await page.evaluate(([token, user, theme]) => {
      localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', theme);
      localStorage.setItem('cordiaWalkthroughDone', '1');
    }, [TOKEN, USER, theme]);
    for (const route of ROUTES) {
      try {
        await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 });
      } catch { /* keep going on slow pages */ }
      await page.waitForTimeout(900);
      const name = `${theme}-${width}_${slug(route)}`;
      result[name] = await capture(page);
      await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
      console.log('captured', name);
    }
    await context.close();
  }
  fs.writeFileSync(path.join(out, 'layout.json'), JSON.stringify(result));
  await browser.close();
})();
